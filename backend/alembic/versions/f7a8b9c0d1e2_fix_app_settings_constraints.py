"""fix app_settings constraints

Revision ID: f7a8b9c0d1e2
Revises: d0e1f2a3b4c5
Create Date: 2026-10-08 14:10:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE app_settings_new (
            id VARCHAR NOT NULL PRIMARY KEY,
            user_id VARCHAR NOT NULL,
            "key" VARCHAR NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_app_settings_user_key UNIQUE (user_id, "key")
        )
        """
    )
    op.execute(
        """
        INSERT INTO app_settings_new (id, user_id, "key", value, updated_at)
        SELECT
            lower(hex(randomblob(4))) || '-' ||
            lower(hex(randomblob(2))) || '-4' ||
            substr(lower(hex(randomblob(2))), 2) || '-' ||
            substr('89ab', abs(random()) % 4 + 1, 1) ||
            substr(lower(hex(randomblob(2))), 2) || '-' ||
            lower(hex(randomblob(6))),
            COALESCE(NULLIF(user_id, ''), 'legacy'),
            "key",
            value,
            updated_at
        FROM app_settings AS candidate
        WHERE candidate.rowid = (
            SELECT duplicate.rowid
            FROM app_settings AS duplicate
            WHERE COALESCE(NULLIF(duplicate.user_id, ''), 'legacy')
                    = COALESCE(NULLIF(candidate.user_id, ''), 'legacy')
              AND duplicate."key" = candidate."key"
            ORDER BY duplicate.updated_at DESC, duplicate.rowid DESC
            LIMIT 1
        )
        """
    )
    op.drop_table("app_settings")
    op.rename_table("app_settings_new", "app_settings")
    op.create_index(
        "ix_app_settings_user_id",
        "app_settings",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE app_settings_legacy (
            "key" VARCHAR NOT NULL PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            id VARCHAR,
            user_id VARCHAR
        )
        """
    )
    op.execute(
        """
        INSERT OR REPLACE INTO app_settings_legacy
            ("key", value, updated_at, id, user_id)
        SELECT "key", value, updated_at, id, user_id
        FROM app_settings
        ORDER BY updated_at, rowid
        """
    )
    op.drop_table("app_settings")
    op.rename_table("app_settings_legacy", "app_settings")
    op.create_index(
        "ix_app_settings_user_id",
        "app_settings",
        ["user_id"],
        unique=False,
    )
