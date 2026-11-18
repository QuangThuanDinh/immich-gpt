"""OIDC-only login and application session endpoints."""
import logging
from html import escape

from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
import httpx
from joserfc.errors import JoseError
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..config import settings, validate_oidc_url
from ..database import get_db
from ..dependencies import get_current_user
from ..limiter import limiter
from ..services.auth_service import create_session, delete_session
from ..services.oidc_service import resolve_oidc_user, verified_oidc_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class UserOut(BaseModel):
    id: str
    email: str | None
    username: str
    role: str
    force_password_change: bool = False


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME, value=session_id, httponly=True,
        secure=settings.SESSION_COOKIE_SECURE or settings.oidc_secure,
        samesite=settings.SESSION_COOKIE_SAMESITE, max_age=7 * 24 * 3600, path="/",
    )


def _oidc_failure(request: Request, error: Exception):
    request.session.clear()
    # Provider error messages can include codes, tokens or secrets.
    logger.warning("OIDC sign-in failed (%s)", type(error).__name__)
    status = error.status_code if isinstance(error, HTTPException) else 401
    if isinstance(error, (httpx.HTTPError, ValueError, TypeError, KeyError)):
        status = 502
    message = (error.detail if isinstance(error, HTTPException) and isinstance(error.detail, str)
               else "Check your provider configuration and account status, then try again.")
    return HTMLResponse(
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Sign-in failed</title><h1>OIDC sign-in failed</h1>'
        f'<p>{escape(message)}</p>'
        '<a href="/login">Return to sign in</a></html>',
        status_code=status,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.get("/oidc/status")
def oidc_status():
    return {"configured": settings.oidc_configured, "login_url": "/api/auth/oidc/login"}


@router.get("/oidc/login")
@limiter.limit("10/minute")
async def oidc_login(request: Request):
    try:
        client = await verified_oidc_client()
        response = await client.authorize_redirect(request, settings.OIDC_REDIRECT_URI, response_mode="query")
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response
    except (HTTPException, OAuthError, JoseError, httpx.HTTPError, ValueError, TypeError, KeyError) as error:
        return _oidc_failure(request, error)


@router.get("/oidc/callback")
async def oidc_callback(request: Request, db: Session = Depends(get_db)):
    try:
        if any(len(request.query_params.getlist(key)) != 1 for key in request.query_params):
            raise HTTPException(status_code=400, detail="Duplicate OIDC callback parameter.")
        if request.query_params.get("iss", settings.OIDC_ISSUER) != settings.OIDC_ISSUER:
            raise HTTPException(status_code=400, detail="Invalid authorization response issuer.")
        client = await verified_oidc_client()
        token = await client.authorize_access_token(
            request, claims_options={"iss": {"essential": True, "value": settings.OIDC_ISSUER}},
            leeway=30,
        )
        identity = token.get("userinfo")
        if not token.get("id_token") or not isinstance(identity, dict):
            raise HTTPException(status_code=401, detail="A validated OIDC ID token is required.")
        subject = identity.get("sub")
        if not isinstance(subject, str) or not subject:
            raise HTTPException(status_code=401, detail="OIDC subject is required.")
        if "preferred_username" not in identity:
            metadata = await client.load_server_metadata()
            endpoint = metadata.get("userinfo_endpoint", "")
            validate_oidc_url(endpoint, "userinfo_endpoint")
            identity = await client.userinfo(token=token)
            if identity.get("sub") != subject:
                raise HTTPException(status_code=401, detail="UserInfo subject does not match the ID token.")
        username = identity.get("preferred_username")
        if not isinstance(username, str) or not username.strip():
            raise HTTPException(status_code=401, detail="A non-empty preferred_username is required.")
        email = identity.get("email")
        email = email.strip().lower() if isinstance(email, str) and email.strip() else None
        user = await run_in_threadpool(resolve_oidc_user, db, subject, username, email)
        old_session = request.cookies.get(settings.SESSION_COOKIE_NAME)
        if old_session:
            await run_in_threadpool(delete_session, db, old_session)
        session = await run_in_threadpool(
            create_session,
            db, user.id, ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"), auth_method="oidc",
        )
        request.session.clear()
        response = RedirectResponse("/", status_code=303, headers={
            "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        })
        _set_session_cookie(response, session.id)
        return response
    except (HTTPException, OAuthError, JoseError, httpx.HTTPError, ValueError, TypeError, KeyError) as error:
        return _oidc_failure(request, error)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    session_id = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if session_id:
        delete_session(db, session_id)
    request.session.clear()
    response.delete_cookie(
        key=settings.SESSION_COOKIE_NAME, path="/",
        secure=settings.SESSION_COOKIE_SECURE or settings.oidc_secure,
        samesite=settings.SESSION_COOKIE_SAMESITE,
    )
    return {"logged_out": True}


@router.get("/me", response_model=UserOut)
def me(current_user=Depends(get_current_user)):
    return UserOut(id=current_user.id, email=current_user.email, username=current_user.username,
                   role=current_user.role)
