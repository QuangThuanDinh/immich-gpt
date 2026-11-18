from sqlalchemy import Column, String, Boolean, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from ..database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("oidc_issuer", "oidc_subject", name="uq_users_oidc_identity"),)

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)
    oidc_issuer = Column(String, nullable=True)
    oidc_subject = Column(String, nullable=True)
    # role: "admin" or "user"
    role = Column(String, nullable=False, default="user")
    is_active = Column(Boolean, default=True, nullable=False)
    force_password_change = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
