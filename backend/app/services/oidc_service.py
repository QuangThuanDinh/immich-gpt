"""OIDC verification and one-time username-based account migration."""
from functools import lru_cache
import uuid

from authlib.integrations.starlette_client import OAuth
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings, validate_oidc_url
from ..models.audit_log import AuditLog
from ..models.session import UserSession, PasswordResetToken
from ..models.user import User
from .user_service import seed_user_defaults


@lru_cache(maxsize=1)
def get_oidc_client():
    if not settings.oidc_configured:
        raise HTTPException(status_code=503, detail="Configure OIDC environment variables before signing in.")
    oauth = OAuth()
    return oauth.register(
        "private_oidc",
        client_id=settings.OIDC_CLIENT_ID,
        client_secret=settings.OIDC_CLIENT_SECRET,
        server_metadata_url=settings.OIDC_ISSUER.rstrip("/") + "/.well-known/openid-configuration",
        client_kwargs={
            "scope": "openid profile email",
            "code_challenge_method": "S256",
            "token_endpoint_auth_method": settings.OIDC_TOKEN_AUTH_METHOD,
            "timeout": 10,
            "follow_redirects": False,
        },
    )


async def verified_oidc_client():
    client = get_oidc_client()
    metadata = await client.load_server_metadata()
    if metadata.get("issuer") != settings.OIDC_ISSUER:
        raise HTTPException(status_code=502, detail="OIDC discovery issuer does not match configuration.")
    for endpoint in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        validate_oidc_url(metadata.get(endpoint, ""), endpoint)
    algorithms = {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512",
                  "ES256", "ES384", "ES512", "EdDSA"}
    supported = algorithms.intersection(metadata.get("id_token_signing_alg_values_supported", ["RS256"]))
    if not supported:
        raise HTTPException(status_code=502, detail="OIDC provider has no supported ID-token signing algorithm.")
    client.server_metadata["id_token_signing_alg_values_supported"] = sorted(supported)
    return client


def resolve_oidc_user(db: Session, subject: str, username: str, email: str | None) -> User:
    try:
        # Serialize first-admin bootstrap and one-time linking across SQLite callbacks.
        if db.get_bind().dialect.name == "sqlite":
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        user = db.query(User).filter(
            User.oidc_issuer == settings.OIDC_ISSUER, User.oidc_subject == subject,
        ).first()
        created = False
        linked = False
        if user is None:
            user = db.query(User).filter(User.username == username).first()
            if user is not None:
                if user.oidc_issuer is not None or user.oidc_subject is not None:
                    raise HTTPException(status_code=409, detail="This username is already linked to another OIDC identity.")
                linked = True
            else:
                first_user = db.query(User.id).first() is None
                user = User(id=str(uuid.uuid4()), username=username, email=email,
                            role="admin" if first_user else "user", is_active=True,
                            force_password_change=False)
                db.add(user)
                created = True
        if not user.is_active:
            raise HTTPException(status_code=403, detail="This account is disabled.")
        user.username = username
        user.oidc_issuer = settings.OIDC_ISSUER
        user.oidc_subject = subject
        user.hashed_password = None
        user.force_password_change = False
        db.flush()
        if created:
            seed_user_defaults(db, user.id)
        if linked:
            db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
            db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete(synchronize_session=False)
        if created or linked:
            db.add(AuditLog(
                id=str(uuid.uuid4()), user_id=user.id,
                action="oidc_user_created" if created else "oidc_account_linked",
                status="success", level="info", source="oidc",
                details_json={"username": username},
            ))
        db.commit()
        db.refresh(user)
        return user
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="OIDC username or email conflicts with an existing account.") from error
    except HTTPException:
        db.rollback()
        raise
