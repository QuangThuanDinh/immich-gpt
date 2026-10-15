from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import require_active_user
from ..models.workflow_schedule import WorkflowSchedule
from ..schemas.workflow_schedule import (
    WorkflowScheduleCreate,
    WorkflowScheduleOut,
    WorkflowScheduleUpdate,
)
from ..services.workflow_scheduler import calculate_next_run, refresh_next_run


router = APIRouter(prefix="/api/workflow-schedules", tags=["workflow-schedules"])


@router.get("", response_model=list[WorkflowScheduleOut])
def list_workflow_schedules(
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    return (
        db.query(WorkflowSchedule)
        .filter(WorkflowSchedule.user_id == current_user.id)
        .order_by(WorkflowSchedule.daily_time.asc(), WorkflowSchedule.id.asc())
        .all()
    )


@router.post("", response_model=WorkflowScheduleOut, status_code=201)
def create_workflow_schedule(
    body: WorkflowScheduleCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    try:
        next_run_at = calculate_next_run(body.daily_time, body.timezone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    schedule = WorkflowSchedule(
        user_id=current_user.id,
        daily_time=body.daily_time,
        timezone=body.timezone,
        enabled=True,
        next_run_at=next_run_at,
    )
    db.add(schedule)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A recurring workflow already exists at this time",
        ) from exc
    db.refresh(schedule)
    return schedule


@router.patch("/{schedule_id}", response_model=WorkflowScheduleOut)
def update_workflow_schedule(
    schedule_id: str,
    body: WorkflowScheduleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    schedule = (
        db.query(WorkflowSchedule)
        .filter(
            WorkflowSchedule.id == schedule_id,
            WorkflowSchedule.user_id == current_user.id,
        )
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Workflow schedule not found")
    schedule.enabled = body.enabled
    refresh_next_run(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


@router.delete("/{schedule_id}")
def delete_workflow_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_active_user),
):
    schedule = (
        db.query(WorkflowSchedule)
        .filter(
            WorkflowSchedule.id == schedule_id,
            WorkflowSchedule.user_id == current_user.id,
        )
        .first()
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Workflow schedule not found")
    db.delete(schedule)
    db.commit()
    return {"deleted": True}
