"""Real OIDC protocol validation, account migration, and OIDC-only API tests."""
import base64
import hashlib
import logging
import time
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient
import httpx
from joserfc import jwt
from joserfc.jwk import RSAKey
import pytest

from app.config import settings
from app.database import get_db
from app.main import app, OIDCCallbackLogFilter
from app.models.bucket import Bucket
from app.models.user import User
from app.models.session import UserSession
from app.services.auth_service import create_session
from app.services.oidc_service import get_oidc_client
from tests.conftest import TEST_USER_ID

ISSUER = "https://identity.example.test"
CALLBACK = "http://testserver/api/auth/oidc/callback"


@pytest.fixture(scope="module")
def signing_key():
    return RSAKey.generate_key(2048, parameters={"kid": "oidc-test"})


@pytest.fixture
def oidc(db, monkeypatch, signing_key):
    monkeypatch.setattr(settings, "OIDC_ISSUER", ISSUER)
    monkeypatch.setattr(settings, "OIDC_CLIENT_ID", "immich")
    monkeypatch.setattr(settings, "OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(settings, "OIDC_REDIRECT_URI", CALLBACK)
    monkeypatch.setattr(settings, "SESSION_COOKIE_SECURE", False)
    get_oidc_client.cache_clear()
    state = {"claims": {}, "nonce": "", "challenge": "", "fail": False, "userinfo": {},
             "bad_signature": False, "metadata": {}}

    def provider(request):
        if state["fail"]:
            raise httpx.ConnectError("sensitive provider error", request=request)
        if request.url.path == "/.well-known/openid-configuration":
            data = {
                "issuer": ISSUER, "authorization_endpoint": ISSUER + "/authorize",
                "token_endpoint": ISSUER + "/token", "jwks_uri": ISSUER + "/jwks",
                "userinfo_endpoint": ISSUER + "/userinfo",
                "id_token_signing_alg_values_supported": ["RS256"],
                **state["metadata"],
            }
        elif request.url.path == "/token":
            form = parse_qs(request.content.decode())
            assert form["grant_type"] == ["authorization_code"]
            assert form["code"] == ["test-code"]
            assert form["redirect_uri"] == [CALLBACK]
            assert request.headers["authorization"].startswith("Basic ")
            challenge = base64.urlsafe_b64encode(
                hashlib.sha256(form["code_verifier"][0].encode()).digest()
            ).rstrip(b"=").decode()
            assert challenge == state["challenge"]
            claims = {
                "iss": ISSUER, "sub": "provider-user", "aud": "immich",
                "iat": int(time.time()), "exp": int(time.time()) + 3600,
                "nonce": state["nonce"], "preferred_username": "testuser",
                **state["claims"],
            }
            claims = {key: value for key, value in claims.items() if value is not None}
            key = RSAKey.generate_key(2048, parameters={"kid": "oidc-test"}) if state["bad_signature"] else signing_key
            data = {"access_token": "test-provider-token", "token_type": "Bearer",
                    "id_token": jwt.encode({"alg": "RS256", "kid": "oidc-test"}, claims, key)}
        elif request.url.path == "/jwks":
            data = {"keys": [signing_key.as_dict(private=False)]}
        elif request.url.path == "/userinfo":
            data = state["userinfo"]
        else:
            pytest.fail(f"Unexpected provider request: {request.method} {request.url.path}")
        return httpx.Response(200, json=data)

    get_oidc_client().client_kwargs["transport"] = httpx.MockTransport(provider)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    try:
        yield client, state
    finally:
        client.close()
        app.dependency_overrides.clear()
        get_oidc_client.cache_clear()


def begin_login(client, state):
    response = client.get("/api/auth/oidc/login", follow_redirects=False)
    assert response.status_code in {302, 307}
    params = parse_qs(urlsplit(response.headers["location"]).query)
    assert params["scope"] == ["openid profile email"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["redirect_uri"] == [CALLBACK]
    state["nonce"], state["challenge"] = params["nonce"][0], params["code_challenge"][0]
    return "/api/auth/oidc/callback?state=" + params["state"][0] + "&code=test-code"


def sign_in(client, state):
    callback = begin_login(client, state)
    return client.get(callback, follow_redirects=False)


@pytest.mark.parametrize("role", ["user", "admin"])
def test_link_existing_username_preserves_data_and_role_and_retires_password(db, oidc, role):
    client, state = oidc
    user = db.get(User, TEST_USER_ID)
    user.force_password_change = True
    user.role = role
    db.commit()
    old_session = create_session(db, user.id)
    old_id = old_session.id
    buckets = {bucket.id for bucket in db.query(Bucket).filter_by(user_id=user.id)}
    response = sign_in(client, state)
    assert response.status_code == 303, response.text
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == user.id
    assert me.json()["role"] == role
    assert me.json()["force_password_change"] is False
    db.refresh(user)
    assert user.oidc_issuer == ISSUER and user.oidc_subject == "provider-user"
    assert user.hashed_password is None
    assert {bucket.id for bucket in db.query(Bucket).filter_by(user_id=user.id)} == buckets
    assert db.get(UserSession, old_id) is None
    cookie = response.headers["set-cookie"]
    assert "session_id=" in cookie and "HttpOnly" in cookie
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_accept_all_new_usernames_without_email_and_seed_personal_defaults(db, oidc):
    client, state = oidc
    for index, username in enumerate(("new-user", "Private User", "name@example.test")):
        state["claims"] = {"sub": f"new-{index}", "preferred_username": username, "email_verified": False}
        assert sign_in(client, state).status_code == 303
        me = client.get("/api/auth/me").json()
        assert me["username"] == username and me["email"] is None and me["role"] == "user"
        assert db.query(Bucket).filter_by(user_id=me["id"]).count() == 4


def test_first_oidc_user_bootstraps_admin_only_on_empty_database(db, oidc):
    client, state = oidc
    db.query(Bucket).delete()
    db.query(User).delete()
    db.commit()
    assert sign_in(client, state).status_code == 303
    assert client.get("/api/auth/me").json()["role"] == "admin"
    state["claims"] = {"sub": "second", "preferred_username": "second"}
    assert sign_in(client, state).status_code == 303
    assert client.get("/api/auth/me").json()["role"] == "user"


def test_stable_subject_keeps_existing_account_after_username_change_and_cannot_steal_another(db, oidc):
    client, state = oidc
    assert sign_in(client, state).status_code == 303
    original_id = client.get("/api/auth/me").json()["id"]
    state["claims"] = {"preferred_username": "renamed"}
    assert sign_in(client, state).status_code == 303
    assert client.get("/api/auth/me").json()["id"] == original_id
    assert client.get("/api/auth/me").json()["username"] == "renamed"
    state["claims"] = {"sub": "attacker", "preferred_username": "renamed"}
    assert sign_in(client, state).status_code == 409
    assert db.get(User, original_id).oidc_subject == "provider-user"


def test_username_link_is_exact_and_disabled_accounts_stay_disabled(db, oidc):
    client, state = oidc
    state["claims"] = {"preferred_username": "TestUser"}
    assert sign_in(client, state).status_code == 303
    assert client.get("/api/auth/me").json()["id"] != TEST_USER_ID
    user = db.get(User, TEST_USER_ID)
    user.is_active = False
    db.commit()
    state["claims"] = {"sub": "disabled", "preferred_username": "testuser"}
    assert sign_in(client, state).status_code == 403
    db.refresh(user)
    assert user.oidc_subject is None


@pytest.mark.parametrize("claims", [
    {"iss": "https://attacker.test"}, {"aud": "wrong-client"},
    {"nonce": "wrong"}, {"nonce": None}, {"exp": time.time() - 120},
    {"preferred_username": ""}, {"preferred_username": " "}, {"preferred_username": 17},
    {"sub": ""}, {"aud": ["immich", "another"], "azp": "wrong-client"},
])
def test_invalid_identity_is_rejected_without_linking(db, oidc, claims):
    client, state = oidc
    state["claims"] = claims
    assert sign_in(client, state).status_code in {401, 502}
    assert db.get(User, TEST_USER_ID).oidc_subject is None
    assert client.get("/api/auth/me").status_code == 401


def test_bad_signature_and_unbound_or_replayed_state_are_rejected(db, oidc):
    client, state = oidc
    state["bad_signature"] = True
    assert sign_in(client, state).status_code == 401
    state["bad_signature"] = False
    callback = begin_login(client, state)
    assert client.get(callback.replace("state=", "state=wrong"), follow_redirects=False).status_code == 401
    callback = begin_login(client, state)
    assert client.get(callback, follow_redirects=False).status_code == 303
    assert client.get(callback, follow_redirects=False).status_code == 401


def test_userinfo_username_requires_matching_subject(oidc):
    client, state = oidc
    state["claims"] = {"preferred_username": None}
    state["userinfo"] = {"sub": "other", "preferred_username": "testuser"}
    assert sign_in(client, state).status_code == 401
    state["userinfo"]["sub"] = "provider-user"
    assert sign_in(client, state).status_code == 303


def test_provider_failures_are_explicit_and_never_expose_errors(oidc):
    client, state = oidc
    state["fail"] = True
    response = client.get("/api/auth/oidc/login")
    assert response.status_code == 502
    assert "sensitive provider error" not in response.text


def test_legacy_sessions_are_rejected_even_for_linked_users(db, oidc):
    client, state = oidc
    assert sign_in(client, state).status_code == 303
    session = create_session(db, TEST_USER_ID)
    client.cookies.set(settings.SESSION_COOKIE_NAME, session.id)
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("path", ["login", "setup", "change-password", "forgot-password", "reset-password"])
def test_local_password_and_setup_endpoints_are_removed(client, path):
    response = client.post("/api/auth/" + path, json={
        "username": "testuser", "password": "testpassword",
        "email": "testuser@example.com", "current_password": "testpassword",
        "new_password": "newpass123", "token": "token",
    })
    assert response.status_code in {404, 405}
    assert "session_id" not in response.cookies


def test_removed_setup_status_is_not_served_as_spa_html(client):
    assert client.get("/api/auth/setup/status").status_code == 404


def test_missing_oidc_configuration_has_no_password_fallback(client, monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ISSUER", "")
    get_oidc_client.cache_clear()
    assert client.get("/api/auth/oidc/status").json()["configured"] is False
    assert client.get("/api/auth/oidc/login").status_code == 503


def test_callback_access_log_redacts_query():
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s %s %s %s %s",
                               ("client", "GET", "/api/auth/oidc/callback?code=secret&state=state", "1.1", 303), None)
    OIDCCallbackLogFilter().filter(record)
    assert "secret" not in record.getMessage()
    assert "/api/auth/oidc/callback" in record.getMessage()
