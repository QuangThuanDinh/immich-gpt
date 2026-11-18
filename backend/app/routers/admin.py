"""
Admin router: user account management.
Admin can manage account status but cannot read user content or secrets.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from typing import List, Optional, Literal
from datetime import datetime

from ..database import get_db
from ..dependencies import require_admin
from ..services.user_service import (
    create_user,
    list_users,
    get_user_by_id,
    set_user_active,
    delete_user,
)
from ..models.user import User

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _active_admin_count(db: Session) -> int:
    return db.query(User).filter(User.role == "admin", User.is_active == True).count()


def _would_remove_last_active_admin(db: Session, user_id: str) -> bool:
    user = get_user_by_id(db, user_id)
    return bool(user and user.role == "admin" and user.is_active and _active_admin_count(db) <= 1)


# ---------------------------------------------------------------------------
# Schemas (no secrets, no user content)
# ---------------------------------------------------------------------------

class AdminUserOut(BaseModel):
    id: str
    email: Optional[str]
    username: str
    role: str
    is_active: bool
    force_password_change: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Optional[str] = None
    username: str
    role: Literal["admin", "user"] = "user"


class UpdateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[AdminUserOut])
def list_all_users(_admin=Depends(require_admin), db: Session = Depends(get_db)):
    users = list_users(db)
    return [
        AdminUserOut(
            id=u.id,
            email=u.email,
            username=u.username,
            role=u.role,
            is_active=u.is_active,
            force_password_change=u.force_password_change,
            created_at=u.created_at,
            updated_at=u.updated_at,
        )
        for u in users
    ]


@router.post("/users", response_model=AdminUserOut)
def create_user_endpoint(
    body: CreateUserRequest,
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    from sqlalchemy.exc import IntegrityError
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username is required")
    try:
        user = create_user(
            db,
            email=body.email,
            username=body.username,
            role=body.role,
            force_password_change=False,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or username already exists")
    return AdminUserOut(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        force_password_change=user.force_password_change,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.is_active is not None:
        if body.is_active is False and _would_remove_last_active_admin(db, user_id):
            raise HTTPException(status_code=400, detail="Cannot disable the last active admin")
        user = set_user_active(db, user_id, body.is_active)

    return AdminUserOut(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        force_password_change=user.force_password_change,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.delete("/users/{user_id}")
def delete_user_endpoint(
    user_id: str,
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    if _would_remove_last_active_admin(db, user_id):
        raise HTTPException(status_code=400, detail="Cannot delete the last active admin")
    deleted = delete_user(db, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"deleted": True}
