from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkflowScheduleCreate(BaseModel):
    daily_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):00$")
    timezone: str = Field(min_length=1, max_length=100)


class WorkflowScheduleUpdate(BaseModel):
    enabled: bool


class WorkflowScheduleOut(BaseModel):
    id: str
    daily_time: str
    timezone: str
    enabled: bool
    next_run_at: datetime | None
    last_run_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
