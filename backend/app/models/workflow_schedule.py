import uuid

from sqlalchemy import Boolean, Column, DateTime, String, UniqueConstraint, func

from ..database import Base


class WorkflowSchedule(Base):
    __tablename__ = "workflow_schedules"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "daily_time",
            "timezone",
            name="uq_workflow_schedules_user_time_timezone",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    daily_time = Column(String, nullable=False)
    timezone = Column(String, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    last_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
