import asyncio
import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.user import User
from ..models.workflow_schedule import WorkflowSchedule


logger = logging.getLogger(__name__)
SCHEDULER_POLL_SECONDS = 10 * 60


def calculate_next_run(
    daily_time: str,
    timezone_name: str,
    *,
    after: datetime | None = None,
) -> datetime:
    try:
        local_timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Unknown timezone") from exc

    hour, minute = (int(part) for part in daily_time.split(":", 1))
    after_utc = after or datetime.now(timezone.utc)
    if after_utc.tzinfo is None:
        after_utc = after_utc.replace(tzinfo=timezone.utc)
    local_after = after_utc.astimezone(local_timezone)
    candidate = datetime.combine(
        local_after.date(),
        time(hour=hour, minute=minute),
        tzinfo=local_timezone,
    )
    if candidate <= local_after:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)


def refresh_next_run(schedule: WorkflowSchedule, *, after: datetime | None = None) -> None:
    schedule.next_run_at = (
        calculate_next_run(schedule.daily_time, schedule.timezone, after=after)
        if schedule.enabled
        else None
    )


def enqueue_due_schedules(db: Session, *, now: datetime | None = None) -> int:
    from ..services.job_progress import JobProgressService
    from ..workers.executor import enqueue_asset_sync

    now_utc = now or datetime.now(timezone.utc)
    if now_utc.tzinfo is not None:
        now_utc = now_utc.astimezone(timezone.utc).replace(tzinfo=None)

    due = (
        db.query(WorkflowSchedule)
        .join(User, User.id == WorkflowSchedule.user_id)
        .filter(
            User.is_active.is_(True),
            WorkflowSchedule.enabled.is_(True),
            WorkflowSchedule.next_run_at.is_not(None),
            WorkflowSchedule.next_run_at <= now_utc,
        )
        .order_by(WorkflowSchedule.next_run_at.asc())
        .all()
    )
    enqueued = 0
    for schedule in due:
        scheduled_for = schedule.next_run_at
        next_run_at = calculate_next_run(
            schedule.daily_time,
            schedule.timezone,
            after=(scheduled_for or now_utc).replace(tzinfo=timezone.utc),
        )
        claimed = (
            db.query(WorkflowSchedule)
            .filter(
                WorkflowSchedule.id == schedule.id,
                WorkflowSchedule.enabled.is_(True),
                WorkflowSchedule.next_run_at == scheduled_for,
            )
            .update(
                {
                    WorkflowSchedule.last_run_at: now_utc,
                    WorkflowSchedule.next_run_at: next_run_at,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if not claimed:
            continue
        jobs = JobProgressService(db)
        recurring_job = jobs.create_job(
            "recurring_workflow",
            params={
                "schedule_id": schedule.id,
                "daily_time": schedule.daily_time,
                "timezone": schedule.timezone,
                "scheduled_for": (
                    scheduled_for.isoformat() if scheduled_for else None
                ),
            },
            user_id=schedule.user_id,
        )
        jobs.start_job(recurring_job.id)
        jobs.update_progress(
            recurring_job.id,
            current_step=(
                f"Recurring run at {schedule.daily_time} "
                f"({schedule.timezone})"
            ),
            log_line=(
                f"Starting recurring Quick Sync + Route for "
                f"{schedule.daily_time} ({schedule.timezone})"
            ),
        )
        try:
            sync_job_id = enqueue_asset_sync(
                db,
                user_id=schedule.user_id,
                scope="all",
                run_routing_after=True,
                quick_sync=True,
                recurring=True,
                auto_approve=True,
                schedule_id=schedule.id,
            )
        except Exception as exc:
            jobs.fail_job(
                recurring_job.id,
                f"Could not start Asset Sync: {exc}",
            )
            raise
        recurring_job.params_json = {
            **(recurring_job.params_json or {}),
            "asset_sync_job_id": sync_job_id,
        }
        db.commit()
        jobs.complete_job(
            recurring_job.id,
            message=f"Started Asset Sync job {sync_job_id}",
        )
        enqueued += 1
        logger.info(
            "Enqueued recurring Quick Sync + Route schedule %s for user %s",
            schedule.id,
            schedule.user_id,
        )
    return enqueued


async def run_scheduler_loop() -> None:
    while True:
        db = SessionLocal()
        try:
            enqueue_due_schedules(db)
        except Exception:
            db.rollback()
            logger.exception("Recurring workflow scheduler tick failed")
        finally:
            db.close()
        await asyncio.sleep(SCHEDULER_POLL_SECONDS)
