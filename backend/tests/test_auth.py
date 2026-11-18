"""Application-session refresh behavior, shared by OIDC sessions."""
from datetime import timedelta
from unittest.mock import MagicMock

from app.services import auth_service
from tests.conftest import TEST_USER_ID


def test_get_session_skips_refresh_inside_throttle_window(db):
    session = auth_service.create_session(db, TEST_USER_ID, auth_method="oidc")
    original_last_seen = session.last_seen_at
    original_expires = session.expires_at
    original_commit = db.commit
    commit = MagicMock(wraps=original_commit)
    db.commit = commit
    try:
        loaded = auth_service.get_session(db, session.id)
    finally:
        db.commit = original_commit
    assert loaded is not None
    assert commit.call_count == 0
    assert loaded.last_seen_at == original_last_seen
    assert loaded.expires_at == original_expires


def test_get_session_refreshes_after_throttle_window(db):
    session = auth_service.create_session(db, TEST_USER_ID, auth_method="oidc")
    old_seen = session.last_seen_at - timedelta(
        seconds=auth_service.SESSION_REFRESH_INTERVAL_SECONDS + 1
    )
    session.last_seen_at = old_seen
    session.expires_at = old_seen + timedelta(seconds=auth_service.SESSION_IDLE_SECONDS)
    old_expires = session.expires_at
    db.commit()
    original_commit = db.commit
    commit = MagicMock(wraps=original_commit)
    db.commit = commit
    try:
        loaded = auth_service.get_session(db, session.id)
    finally:
        db.commit = original_commit
    assert loaded is not None
    assert commit.call_count == 1
    assert loaded.last_seen_at > old_seen
    assert loaded.expires_at > old_expires
