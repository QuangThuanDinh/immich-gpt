from datetime import datetime, timezone

from app.models.workflow_schedule import WorkflowSchedule
from app.models.job_run import JobRun
from app.services.workflow_scheduler import (
    SCHEDULER_POLL_SECONDS,
    calculate_next_run,
    enqueue_due_schedules,
)


def test_scheduler_scans_every_ten_minutes():
    assert SCHEDULER_POLL_SECONDS == 10 * 60


def test_schedule_crud_is_owned_by_current_user(client, db, test_admin):
    other_schedule = WorkflowSchedule(
        user_id=test_admin.id,
        daily_time="08:00",
        timezone="UTC",
        enabled=True,
        next_run_at=datetime(2026, 10, 15, 8, 0),
    )
    db.add(other_schedule)
    db.commit()

    created = client.post(
        "/api/workflow-schedules",
        json={"daily_time": "06:00", "timezone": "UTC"},
    )
    assert created.status_code == 201
    schedule_id = created.json()["id"]

    listed = client.get("/api/workflow-schedules")
    assert listed.status_code == 200
    assert [schedule["id"] for schedule in listed.json()] == [schedule_id]

    paused = client.patch(
        f"/api/workflow-schedules/{schedule_id}",
        json={"enabled": False},
    )
    assert paused.status_code == 200
    assert paused.json()["enabled"] is False
    assert paused.json()["next_run_at"] is None

    assert client.patch(
        f"/api/workflow-schedules/{other_schedule.id}",
        json={"enabled": False},
    ).status_code == 404
    assert client.delete(
        f"/api/workflow-schedules/{other_schedule.id}",
    ).status_code == 404

    deleted = client.delete(f"/api/workflow-schedules/{schedule_id}")
    assert deleted.status_code == 200
    assert db.query(WorkflowSchedule).filter(
        WorkflowSchedule.id == schedule_id,
    ).first() is None


def test_schedule_rejects_minutes_and_duplicate_hour(client):
    invalid = client.post(
        "/api/workflow-schedules",
        json={"daily_time": "06:30", "timezone": "UTC"},
    )
    assert invalid.status_code == 422

    payload = {"daily_time": "06:00", "timezone": "UTC"}
    assert client.post("/api/workflow-schedules", json=payload).status_code == 201
    duplicate = client.post("/api/workflow-schedules", json=payload)
    assert duplicate.status_code == 409


def test_next_run_uses_schedule_timezone():
    next_run = calculate_next_run(
        "09:00",
        "Asia/Bangkok",
        after=datetime(2026, 10, 14, 3, 0, tzinfo=timezone.utc),
    )
    assert next_run == datetime(2026, 10, 15, 2, 0)


def test_due_schedule_enqueues_recurring_quick_sync(db, test_user, monkeypatch):
    schedule = WorkflowSchedule(
        user_id=test_user.id,
        daily_time="06:00",
        timezone="UTC",
        enabled=True,
        next_run_at=datetime(2026, 10, 14, 6, 0),
    )
    db.add(schedule)
    db.commit()
    calls = []
    monkeypatch.setattr(
        "app.workers.executor.enqueue_asset_sync",
        lambda *args, **kwargs: calls.append((args, kwargs)) or "sync-job-id",
    )

    count = enqueue_due_schedules(
        db,
        now=datetime(2026, 10, 14, 6, 0, tzinfo=timezone.utc),
    )

    assert count == 1
    assert calls[0][1] == {
        "user_id": test_user.id,
        "scope": "all",
        "run_routing_after": True,
        "quick_sync": True,
        "recurring": True,
        "auto_approve": True,
        "schedule_id": schedule.id,
    }
    db.refresh(schedule)
    assert schedule.last_run_at == datetime(2026, 10, 14, 6, 0)
    assert schedule.next_run_at == datetime(2026, 10, 15, 6, 0)
    recurring_job = db.query(JobRun).filter(
        JobRun.job_type == "recurring_workflow",
        JobRun.user_id == test_user.id,
    ).one()
    assert recurring_job.status == "completed"
    assert recurring_job.current_step == "Recurring run at 06:00 (UTC)"
    assert recurring_job.params_json["schedule_id"] == schedule.id
    assert recurring_job.params_json["asset_sync_job_id"] == "sync-job-id"
