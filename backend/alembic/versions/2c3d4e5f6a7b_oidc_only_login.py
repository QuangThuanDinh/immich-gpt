"""Link OIDC identities and retire password sessions.

Revision ID: 2c3d4e5f6a7b
Revises: 1b2c3d4e5f6a
"""
from alembic import op
import sqlalchemy as sa

revision = "2c3d4e5f6a7b"
down_revision = "1b2c3d4e5f6a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("oidc_issuer", sa.String(), nullable=True))
        batch.add_column(sa.Column("oidc_subject", sa.String(), nullable=True))
        batch.alter_column("email", existing_type=sa.String(), nullable=True)
        batch.alter_column("hashed_password", existing_type=sa.String(), nullable=True)
        batch.create_unique_constraint("uq_users_oidc_identity", ["oidc_issuer", "oidc_subject"])
    with op.batch_alter_table("user_sessions") as batch:
        batch.add_column(sa.Column("auth_method", sa.String(), nullable=False, server_default="legacy"))
    op.execute("DELETE FROM user_sessions")
    op.execute("DELETE FROM password_reset_tokens")
    op.execute("UPDATE users SET force_password_change = 0")


def downgrade() -> None:
    # OIDC-only accounts cannot be restored to password accounts without operator action.
    connection = op.get_bind()
    if connection.execute(sa.text(
        "SELECT COUNT(*) FROM users WHERE email IS NULL OR hashed_password IS NULL"
    )).scalar_one():
        raise RuntimeError("Cannot downgrade OIDC-only accounts without restoring their email and password credentials.")
    with op.batch_alter_table("user_sessions") as batch:
        batch.drop_column("auth_method")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_oidc_identity", type_="unique")
        batch.drop_column("oidc_subject")
        batch.drop_column("oidc_issuer")
        batch.alter_column("email", existing_type=sa.String(), nullable=False)
        batch.alter_column("hashed_password", existing_type=sa.String(), nullable=False)
