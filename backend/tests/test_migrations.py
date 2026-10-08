"""
Alembic migration round-trip test.

Verifies that:
1. upgrade head applies all migrations cleanly to a fresh SQLite DB.
2. downgrade -1 from head can be applied without errors.
3. re-upgrade head succeeds after a downgrade.

These tests run against a temporary SQLite file and do NOT touch the
application database.  They require no Redis, Immich, or OpenAI.
"""
import os
import tempfile
import pytest
from alembic.config import Config
from alembic import command
from sqlalchemy import create_engine, inspect, text


@pytest.fixture(scope="module")
def alembic_cfg():
    """Return an Alembic Config pointing at the repo alembic.ini."""
    here = os.path.dirname(os.path.abspath(__file__))
    ini_path = os.path.join(here, "..", "alembic.ini")
    cfg = Config(ini_path)
    return cfg


def _run_with_temp_db(alembic_cfg: Config, fn):
    """Execute *fn(cfg)* against a fresh temporary SQLite database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        tmp_path = f.name
    try:
        cfg = Config(alembic_cfg.config_file_name)
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{tmp_path}")
        fn(cfg)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def test_upgrade_head(alembic_cfg):
    """All pending migrations apply to a blank DB without error."""
    def run(cfg):
        command.upgrade(cfg, "head")

    _run_with_temp_db(alembic_cfg, run)


def test_downgrade_minus_one(alembic_cfg):
    """Can downgrade one step from head without error."""
    def run(cfg):
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "-1")

    _run_with_temp_db(alembic_cfg, run)


def test_upgrade_after_downgrade(alembic_cfg):
    """Re-upgrading after a downgrade returns to head cleanly."""
    def run(cfg):
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "-1")
        command.upgrade(cfg, "head")

    _run_with_temp_db(alembic_cfg, run)


def test_full_downgrade_and_reupgrade(alembic_cfg):
    """Downgrade all the way to base, then upgrade back to head."""
    def run(cfg):
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")
        command.upgrade(cfg, "head")

    _run_with_temp_db(alembic_cfg, run)


def test_app_settings_constraints_support_atomic_user_key_upsert(alembic_cfg):
    def run(cfg):
        command.upgrade(cfg, "d0e1f2a3b4c5")
        engine = create_engine(cfg.get_main_option("sqlalchemy.url"))
        with engine.begin() as connection:
            connection.execute(text(
                """
                INSERT INTO app_settings ("key", value, id, user_id)
                VALUES ('timezone', 'UTC', 'legacy-id', 'user-1')
                """
            ))
        command.upgrade(cfg, "head")

        inspector = inspect(engine)
        assert inspector.get_pk_constraint("app_settings")["constrained_columns"] == ["id"]
        assert any(
            constraint["column_names"] == ["user_id", "key"]
            for constraint in inspector.get_unique_constraints("app_settings")
        )
        with engine.begin() as connection:
            connection.execute(text(
                """
                INSERT INTO app_settings (id, user_id, "key", value)
                VALUES ('new-id', 'user-1', 'timezone', 'America/Los_Angeles')
                ON CONFLICT (user_id, "key")
                DO UPDATE SET value = excluded.value
                """
            ))
            value = connection.execute(text(
                """
                SELECT value FROM app_settings
                WHERE user_id = 'user-1' AND "key" = 'timezone'
                """
            )).scalar_one()
        assert value == "America/Los_Angeles"

    _run_with_temp_db(alembic_cfg, run)
