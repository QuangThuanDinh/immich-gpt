"""add_absent_tag_evaluation

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-02 18:35:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "routing_evaluation_items",
        sa.Column("expected_absent_tag", sa.String(), nullable=True),
    )
    op.add_column(
        "routing_evaluation_items",
        sa.Column("absent_tag_matched", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("routing_evaluation_items", "absent_tag_matched")
    op.drop_column("routing_evaluation_items", "expected_absent_tag")
