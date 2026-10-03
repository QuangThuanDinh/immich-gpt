"""add_routing_evaluations

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-02 14:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "routing_evaluations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("max_score", sa.Float(), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_routing_evaluations_user"),
    )
    op.create_index(
        op.f("ix_routing_evaluations_user_id"),
        "routing_evaluations",
        ["user_id"],
        unique=False,
    )
    op.create_table(
        "routing_evaluation_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("evaluation_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("immich_id", sa.String(), nullable=False),
        sa.Column("expected_tag", sa.String(), nullable=True),
        sa.Column("expected_destination", sa.String(), nullable=True),
        sa.Column("result_description", sa.Text(), nullable=True),
        sa.Column("result_tags_json", sa.JSON(), nullable=True),
        sa.Column("result_destination", sa.String(), nullable=True),
        sa.Column("result_disposition", sa.String(), nullable=True),
        sa.Column("tag_matched", sa.Boolean(), nullable=True),
        sa.Column("destination_matched", sa.Boolean(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("max_score", sa.Float(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_routing_evaluation_items_evaluation_id"),
        "routing_evaluation_items",
        ["evaluation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_routing_evaluation_items_user_id"),
        "routing_evaluation_items",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_routing_evaluation_items_user_id"),
        table_name="routing_evaluation_items",
    )
    op.drop_index(
        op.f("ix_routing_evaluation_items_evaluation_id"),
        table_name="routing_evaluation_items",
    )
    op.drop_table("routing_evaluation_items")
    op.drop_index(
        op.f("ix_routing_evaluations_user_id"),
        table_name="routing_evaluations",
    )
    op.drop_table("routing_evaluations")
