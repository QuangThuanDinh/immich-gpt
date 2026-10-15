"""add routing plan archives

Revision ID: 0a1b2c3d4e5f
Revises: f7a8b9c0d1e2
Create Date: 2026-10-14 14:52:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0a1b2c3d4e5f"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "routing_plans",
        sa.Column(
            "archived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_routing_plans_archived",
        "routing_plans",
        ["archived"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_routing_plans_archived", table_name="routing_plans")
    op.drop_column("routing_plans", "archived")
