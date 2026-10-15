"""add per-user workflow schedules

Revision ID: 1b2c3d4e5f6a
Revises: 0a1b2c3d4e5f
Create Date: 2026-10-14 18:25:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "1b2c3d4e5f6a"
down_revision: Union[str, Sequence[str], None] = "0a1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_schedules",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("daily_time", sa.String(), nullable=False),
        sa.Column("timezone", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "daily_time",
            "timezone",
            name="uq_workflow_schedules_user_time_timezone",
        ),
    )
    op.create_index(
        "ix_workflow_schedules_user_id",
        "workflow_schedules",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_workflow_schedules_next_run_at",
        "workflow_schedules",
        ["next_run_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_workflow_schedules_next_run_at",
        table_name="workflow_schedules",
    )
    op.drop_index(
        "ix_workflow_schedules_user_id",
        table_name="workflow_schedules",
    )
    op.drop_table("workflow_schedules")
