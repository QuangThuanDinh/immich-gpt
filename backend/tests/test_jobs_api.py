"""
Tests for /api/jobs router.

Covers: list, get, start sync, start classify, cancel.
Redis / RQ are never touched; patched out entirely.
"""
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.asset import Asset
from app.models.job_run import JobRun


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_job(db, job_type="asset_sync", status="queued") -> JobRun:
    from tests.conftest import TEST_USER_ID
    job = JobRun(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        job_type=job_type,
        status=status,
        processed_count=0,
        total_count=0,
        success_count=0,
        error_count=0,
        progress_percent=0.0,
        log_lines_json=[],
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _make_legacy_job(db, job_type="asset_sync", status="queued") -> JobRun:
    job = JobRun(
        id=str(uuid.uuid4()),
        user_id=None,
        job_type=job_type,
        status=status,
        processed_count=0,
        total_count=0,
        success_count=0,
        error_count=0,
        progress_percent=0.0,
        log_lines_json=[],
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


# ---------------------------------------------------------------------------
# GET /api/jobs
# ---------------------------------------------------------------------------

def test_list_jobs_empty(client):
    r = client.get("/api/jobs")
    assert r.status_code == 200
    assert r.json() == []


def test_list_jobs_returns_all(client, db):
    _make_job(db, "asset_sync", "queued")
    _make_job(db, "classification", "completed")
    r = client.get("/api/jobs")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_list_jobs_filter_by_type(client, db):
    _make_job(db, "asset_sync", "queued")
    _make_job(db, "classification", "queued")
    r = client.get("/api/jobs?job_type=asset_sync")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["job_type"] == "asset_sync"


def test_list_jobs_filter_by_status(client, db):
    _make_job(db, "asset_sync", "completed")
    _make_job(db, "asset_sync", "failed")
    r = client.get("/api/jobs?status=completed")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["status"] == "completed"


def test_list_jobs_limit(client, db):
    for _ in range(5):
        _make_job(db)
    r = client.get("/api/jobs?limit=3")
    assert r.status_code == 200
    assert len(r.json()) == 3


# ---------------------------------------------------------------------------
# GET /api/jobs/{job_id}
# ---------------------------------------------------------------------------

def test_get_job(client, db):
    job = _make_job(db)
    r = client.get(f"/api/jobs/{job.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == job.id
    assert data["job_type"] == "asset_sync"
    assert data["status"] == "queued"


def test_get_job_not_found(client):
    r = client.get("/api/jobs/nonexistent-id")
    assert r.status_code == 404


def test_get_legacy_unowned_job_not_found(client, db):
    job = _make_legacy_job(db)
    r = client.get(f"/api/jobs/{job.id}")
    assert r.status_code == 404


def test_get_job_fields(client, db):
    job = _make_job(db)
    data = client.get(f"/api/jobs/{job.id}").json()
    for field in ("id", "job_type", "status", "progress_percent",
                  "processed_count", "total_count", "success_count",
                  "error_count", "created_at"):
        assert field in data


# ---------------------------------------------------------------------------
# POST /api/jobs/sync
# ---------------------------------------------------------------------------

def test_start_sync_job(client):
    with patch("app.routers.jobs._enqueue") as mock_enqueue:
        r = client.post("/api/jobs/sync")
    assert r.status_code == 200
    data = r.json()
    assert "job_id" in data
    assert data["status"] == "queued"
    mock_enqueue.assert_called_once()


def test_start_sync_job_creates_db_record(client, db):
    with patch("app.routers.jobs._enqueue"):
        r = client.post("/api/jobs/sync")
    job_id = r.json()["job_id"]
    job = db.query(JobRun).filter(JobRun.id == job_id).first()
    assert job is not None
    assert job.job_type == "asset_sync"


def test_start_sync_job_persists_route_after_sync(client, db):
    with patch("app.routers.jobs._enqueue") as mock_enqueue:
        r = client.post("/api/jobs/sync", json={"scope": "all", "run_routing_after": True})
    assert r.status_code == 200
    job = db.query(JobRun).filter(JobRun.id == r.json()["job_id"]).first()
    assert job.params_json["run_routing_after"] is True
    assert job.params_json["quick_sync"] is False
    assert job.params_json["full_sync"] is False
    assert mock_enqueue.call_args.args[-3:] == (True, False, False)


def test_start_sync_job_persists_full_sync(client, db):
    with patch("app.routers.jobs._enqueue") as mock_enqueue:
        r = client.post("/api/jobs/sync", json={"scope": "all", "full_sync": True})

    assert r.status_code == 200
    job = db.query(JobRun).filter(JobRun.id == r.json()["job_id"]).first()
    assert job.params_json["full_sync"] is True
    assert mock_enqueue.call_args.args[-2:] == (True, False)


def test_start_sync_job_persists_quick_sync(client, db):
    with patch("app.routers.jobs._enqueue") as mock_enqueue:
        r = client.post("/api/jobs/sync", json={"scope": "all", "quick_sync": True})

    assert r.status_code == 200
    job = db.query(JobRun).filter(JobRun.id == r.json()["job_id"]).first()
    assert job.params_json["quick_sync"] is True
    assert job.params_json["full_sync"] is False
    assert mock_enqueue.call_args.args[-2:] == (False, True)


def test_start_sync_job_rejects_conflicting_modes(client):
    r = client.post(
        "/api/jobs/sync",
        json={"scope": "all", "quick_sync": True, "full_sync": True},
    )

    assert r.status_code == 422


def test_run_asset_sync_enqueues_routing_after_success(db, monkeypatch):
    from app.services.job_progress import JobProgressService
    from app.workers.tasks import run_asset_sync
    from tests.conftest import TEST_USER_ID

    job = JobProgressService(db).create_job(
        "asset_sync",
        params={"scope": "all", "run_routing_after": True},
        user_id=TEST_USER_ID,
    )
    enqueued = []

    class FakeAssetSyncService:
        def __init__(self, *args, **kwargs):
            pass

        def sync_all(self, **kwargs):
            return {
                "synced": 1,
                "created": 1,
                "updated": 0,
                "unchanged": 4,
                "errors": 0,
                "created_asset_ids": ["new-local-id"],
            }

    monkeypatch.setattr("app.workers.tasks.SessionLocal", lambda: db)
    monkeypatch.setattr("app.workers.tasks._get_user_immich_client", lambda *args: object())
    monkeypatch.setattr("app.workers.tasks.AssetSyncService", FakeAssetSyncService)
    monkeypatch.setattr(
        "app.workers.executor.enqueue_routing_classification",
        lambda *args, **kwargs: enqueued.append((args, kwargs)),
    )

    job_id = job.id
    run_asset_sync(job_id, user_id=TEST_USER_ID, run_routing_after=True)

    refreshed = db.query(JobRun).filter(JobRun.id == job_id).first()
    assert refreshed.status == "completed"
    assert refreshed.message == (
        "Sync complete. Hydrated: 1, Created: 1, Updated: 0, Unchanged: 4, "
        "Live Photo motion assets filtered: 0, Errors: 0"
    )
    assert enqueued
    assert enqueued[0][1]["user_id"] == TEST_USER_ID
    assert enqueued[0][1]["asset_ids"] == ["new-local-id"]
    assert enqueued[0][1]["force"] is False


def test_quick_sync_uses_cursor_overlap_and_routes_new_assets(db, monkeypatch):
    from app.models.app_setting import AppSetting
    from app.services.job_progress import JobProgressService
    from app.workers.tasks import run_asset_sync
    from tests.conftest import TEST_USER_ID

    job = JobProgressService(db).create_job(
        "asset_sync",
        params={
            "scope": "all",
            "run_routing_after": True,
            "quick_sync": True,
        },
        user_id=TEST_USER_ID,
    )
    cursor = AppSetting(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        key="quick_sync_cursor:all",
        value="2026-10-08T18:00:00Z",
    )
    db.add(cursor)
    db.commit()
    cursor_id = cursor.id
    sync_kwargs = {}
    enqueued = []

    class FakeAssetSyncService:
        def __init__(self, *args, **kwargs):
            pass

        def sync_all(self, **kwargs):
            sync_kwargs.update(kwargs)
            return {
                "synced": 1,
                "created": 1,
                "updated": 0,
                "unchanged": 0,
                "errors": 0,
                "scan_completed": True,
                "created_asset_ids": ["new-local-id"],
            }

    monkeypatch.setattr("app.workers.tasks.SessionLocal", lambda: db)
    monkeypatch.setattr(
        "app.workers.tasks._get_user_immich_client",
        lambda *args: object(),
    )
    monkeypatch.setattr(
        "app.workers.tasks.AssetSyncService",
        FakeAssetSyncService,
    )
    monkeypatch.setattr(
        "app.workers.executor.enqueue_routing_classification",
        lambda *args, **kwargs: enqueued.append((args, kwargs)),
    )

    run_asset_sync(
        job.id,
        user_id=TEST_USER_ID,
        run_routing_after=True,
        quick_sync=True,
    )

    assert sync_kwargs["quick_sync"] is True
    assert sync_kwargs["created_after"] == "2026-10-08T17:55:00Z"
    assert sync_kwargs["created_before"] is not None
    assert enqueued[0][1]["asset_ids"] == ["new-local-id"]
    refreshed_cursor = db.query(AppSetting).filter(
        AppSetting.id == cursor_id
    ).one()
    assert refreshed_cursor.value > "2026-10-08T18:00:00Z"


def test_sync_cursor_never_moves_backwards(db):
    from datetime import datetime, timezone

    from app.models.app_setting import AppSetting
    from app.workers.tasks import _set_sync_cursor
    from tests.conftest import TEST_USER_ID

    _set_sync_cursor(
        db,
        TEST_USER_ID,
        "all",
        None,
        datetime(2026, 10, 8, 20, 0, tzinfo=timezone.utc),
    )
    _set_sync_cursor(
        db,
        TEST_USER_ID,
        "all",
        None,
        datetime(2026, 10, 8, 19, 0, tzinfo=timezone.utc),
    )

    cursor = db.query(AppSetting).filter(
        AppSetting.user_id == TEST_USER_ID,
        AppSetting.key == "quick_sync_cursor:all",
    ).one()
    assert cursor.value == "2026-10-08T20:00:00Z"


def test_resumed_quick_sync_routes_assets_created_before_pause(db, monkeypatch):
    from app.services.job_progress import JobProgressService
    from app.workers.tasks import run_asset_sync
    from tests.conftest import TEST_USER_ID

    job = JobProgressService(db).create_job(
        "asset_sync",
        params={
            "scope": "all",
            "run_routing_after": True,
            "quick_sync": True,
        },
        user_id=TEST_USER_ID,
    )
    job_id = job.id
    calls = 0
    enqueued = []

    class FakeAssetSyncService:
        def __init__(self, *args, **kwargs):
            pass

        def sync_all(self, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                current = db.query(JobRun).filter(JobRun.id == job_id).one()
                current.status = "paused"
                db.commit()
                created_ids = ["created-before-pause"]
                completed = False
            else:
                created_ids = []
                completed = True
            return {
                "synced": len(created_ids),
                "created": len(created_ids),
                "updated": 0,
                "unchanged": 0,
                "errors": 0,
                "scan_completed": completed,
                "created_asset_ids": created_ids,
            }

    monkeypatch.setattr("app.workers.tasks.SessionLocal", lambda: db)
    monkeypatch.setattr(
        "app.workers.tasks._get_user_immich_client",
        lambda *args: object(),
    )
    monkeypatch.setattr(
        "app.workers.tasks.AssetSyncService",
        FakeAssetSyncService,
    )
    monkeypatch.setattr(
        "app.workers.executor.enqueue_routing_classification",
        lambda *args, **kwargs: enqueued.append((args, kwargs)),
    )

    run_asset_sync(
        job_id,
        user_id=TEST_USER_ID,
        run_routing_after=True,
        quick_sync=True,
    )
    paused = db.query(JobRun).filter(JobRun.id == job_id).one()
    assert paused.status == "paused"
    assert paused.params_json["created_asset_ids"] == ["created-before-pause"]
    assert enqueued == []

    paused.status = "queued"
    db.commit()
    run_asset_sync(
        job_id,
        user_id=TEST_USER_ID,
        run_routing_after=True,
        quick_sync=True,
    )

    assert enqueued[0][1]["asset_ids"] == ["created-before-pause"]


def test_run_asset_sync_does_not_enqueue_routing_when_paused(db, monkeypatch):
    from app.services.job_progress import JobProgressService
    from app.workers.tasks import run_asset_sync
    from tests.conftest import TEST_USER_ID

    job = JobProgressService(db).create_job(
        "asset_sync",
        params={"scope": "all", "run_routing_after": True},
        user_id=TEST_USER_ID,
    )
    enqueued = []

    class FakeAssetSyncService:
        def __init__(self, *args, **kwargs):
            pass

        def sync_all(self, **kwargs):
            job.status = "paused"
            db.commit()
            return {"synced": 0, "created": 0, "updated": 0, "errors": 0}

    monkeypatch.setattr("app.workers.tasks.SessionLocal", lambda: db)
    monkeypatch.setattr("app.workers.tasks._get_user_immich_client", lambda *args: object())
    monkeypatch.setattr("app.workers.tasks.AssetSyncService", FakeAssetSyncService)
    monkeypatch.setattr(
        "app.workers.executor.enqueue_routing_classification",
        lambda *args, **kwargs: enqueued.append((args, kwargs)),
    )

    job_id = job.id
    run_asset_sync(job_id, user_id=TEST_USER_ID, run_routing_after=True)

    refreshed = db.query(JobRun).filter(JobRun.id == job_id).first()
    assert refreshed.status == "paused"
    assert enqueued == []


def test_run_asset_sync_stop_check_preserves_pending_asset_updates(
    db,
    monkeypatch,
):
    from app.services.job_progress import JobProgressService
    from app.workers.tasks import run_asset_sync
    from tests.conftest import TEST_USER_ID

    job = JobProgressService(db).create_job(
        "asset_sync",
        params={"scope": "all", "full_sync": True},
        user_id=TEST_USER_ID,
    )
    asset = Asset(
        id="local-asset",
        user_id=TEST_USER_ID,
        immich_id="immich-asset",
        asset_type="IMAGE",
        people_json=None,
        faces_json=None,
    )
    db.add(asset)
    db.commit()
    asset_id = asset.id
    ControlSession = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db.get_bind(),
    )
    session_calls = 0

    def session_factory():
        nonlocal session_calls
        session_calls += 1
        return db if session_calls == 1 else ControlSession()

    class FakeAssetSyncService:
        def __init__(self, *args, **kwargs):
            pass

        def sync_all(self, **kwargs):
            asset.people_json = [{"id": "person-1", "name": "Minh Ha"}]
            asset.faces_json = [{"id": "face-1", "person_name": "Minh Ha"}]

            assert kwargs["should_stop"]() is False
            assert asset in db.dirty
            assert asset.people_json[0]["name"] == "Minh Ha"

            db.commit()
            return {
                "synced": 1,
                "created": 0,
                "updated": 1,
                "unchanged": 0,
                "errors": 0,
            }

    monkeypatch.setattr("app.workers.tasks.SessionLocal", session_factory)
    monkeypatch.setattr(
        "app.workers.tasks._get_user_immich_client",
        lambda *args: object(),
    )
    monkeypatch.setattr(
        "app.workers.tasks.AssetSyncService",
        FakeAssetSyncService,
    )

    run_asset_sync(
        job.id,
        user_id=TEST_USER_ID,
        full_sync=True,
    )

    refreshed = db.query(Asset).filter(Asset.id == asset_id).one()
    assert refreshed.people_json[0]["name"] == "Minh Ha"
    assert refreshed.faces_json[0]["person_name"] == "Minh Ha"
    assert session_calls >= 2


# ---------------------------------------------------------------------------
# POST /api/routing/classify
# ---------------------------------------------------------------------------

def test_start_routing_classify_job(client):
    with patch("app.workers.executor.enqueue") as mock_enqueue:
        r = client.post("/api/routing/classify", json={})
    assert r.status_code == 200
    data = r.json()
    assert "job_id" in data
    assert "plan_id" in data
    assert data["status"] == "queued"
    mock_enqueue.assert_called_once()


def test_start_routing_classify_creates_db_record(client, db):
    with patch("app.workers.executor.enqueue"):
        r = client.post("/api/routing/classify", json={"limit": 10})
    job_id = r.json()["job_id"]
    job = db.query(JobRun).filter(JobRun.id == job_id).first()
    assert job is not None
    assert job.job_type == "routing_classification"


def test_start_routing_classify_persists_plan_id(client, db):
    with patch("app.workers.executor.enqueue"):
        r = client.post("/api/routing/classify", json={"limit": 10})
    job = db.query(JobRun).filter(JobRun.id == r.json()["job_id"]).first()
    assert job.params_json["plan_id"] == r.json()["plan_id"]


def test_start_routing_classify_persists_review_only(client, db):
    with patch("app.workers.executor.enqueue") as mock_enqueue:
        r = client.post(
            "/api/routing/classify",
            json={"asset_ids": ["asset-1"], "force": True, "review_only": True},
        )

    assert r.status_code == 200
    job = db.query(JobRun).filter(JobRun.id == r.json()["job_id"]).first()
    assert job.params_json["review_only"] is True
    assert mock_enqueue.call_args.args[-1] is True


def test_resume_routing_classification_uses_original_plan(db, monkeypatch):
    from app.routers.jobs import _resume_job_task
    from app.services.job_progress import JobProgressService
    from app.services.routing_plan_service import RoutingPlanService
    from tests.conftest import TEST_USER_ID

    job = JobProgressService(db).create_job(
        "routing_classification",
        params={"asset_ids": None, "limit": None, "force": False},
        user_id=TEST_USER_ID,
    )
    plan = RoutingPlanService(db, TEST_USER_ID).create_plan(job_id=job.id)
    plan_id = plan.id
    job.params_json = {"asset_ids": None, "limit": None, "force": False, "plan_id": plan_id}
    db.commit()
    captured = []

    monkeypatch.setattr("app.database.SessionLocal", lambda: db)
    monkeypatch.setattr(
        "app.workers.tasks.run_routing_classification",
        lambda *args: captured.append(args),
    )

    _resume_job_task(job.id)

    assert captured
    assert captured[0][0] == job.id
    assert captured[0][1] == plan_id


def test_resume_legacy_job_without_owner_fails(db, monkeypatch):
    from app.routers.jobs import _resume_job_task

    job = _make_legacy_job(db, job_type="routing_classification", status="queued")
    job_id = job.id

    class NonClosingSession:
        def __init__(self, wrapped):
            self._wrapped = wrapped

        def __getattr__(self, name):
            return getattr(self._wrapped, name)

        def close(self):
            pass

    monkeypatch.setattr("app.database.SessionLocal", lambda: NonClosingSession(db))

    _resume_job_task(job_id)

    refreshed = db.query(JobRun).filter(JobRun.id == job_id).first()
    assert refreshed.status == "failed"
    assert "missing an owner" in refreshed.message


# ---------------------------------------------------------------------------
# POST /api/jobs/{job_id}/cancel
# ---------------------------------------------------------------------------

def test_cancel_job(client, db):
    job = _make_job(db, status="queued")
    r = client.post(f"/api/jobs/{job.id}/cancel")
    assert r.status_code == 200
    assert r.json()["cancelled"] is True


def test_cancel_job_not_found(client):
    r = client.post("/api/jobs/nonexistent/cancel")
    assert r.status_code == 404


def test_cancel_legacy_unowned_job_not_found(client, db):
    job = _make_legacy_job(db)
    r = client.post(f"/api/jobs/{job.id}/cancel")
    assert r.status_code == 404


def test_cancel_completed_job_rejected(client, db):
    job = _make_job(db, status="completed")
    r = client.post(f"/api/jobs/{job.id}/cancel")
    assert r.status_code == 400


def test_cancel_failed_job_rejected(client, db):
    job = _make_job(db, status="failed")
    r = client.post(f"/api/jobs/{job.id}/cancel")
    assert r.status_code == 400


def test_cancel_already_cancelled_rejected(client, db):
    job = _make_job(db, status="cancelled")
    r = client.post(f"/api/jobs/{job.id}/cancel")
    assert r.status_code == 400
