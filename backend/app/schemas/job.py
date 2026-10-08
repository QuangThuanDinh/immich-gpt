from pydantic import BaseModel, ConfigDict, model_validator
from typing import Optional, List, Literal
from datetime import datetime


class JobRunOut(BaseModel):
    id: str
    job_type: str
    status: str
    current_step: Optional[str]
    progress_percent: float
    processed_count: int
    total_count: int
    success_count: int
    error_count: int
    message: Optional[str]
    log_lines: Optional[List[str]]
    started_at: Optional[datetime]
    updated_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class JobStartResponse(BaseModel):
    job_id: str
    status: str
    message: str


class SyncJobRequest(BaseModel):
    """Parameters controlling what gets synced from Immich.

    scope:
      - "all"       – every asset (current default behaviour)
      - "favorites" – only assets marked as favourite
      - "albums"    – only assets belonging to the albums listed in album_ids

    Normal incremental sync is the default. Set quick_sync to fetch only assets
    uploaded since the last successful scan, or full_sync to rehydrate every
    asset in the selected scope.
    """

    scope: Literal["all", "favorites", "albums"] = "all"
    album_ids: Optional[List[str]] = None
    run_routing_after: bool = False
    quick_sync: bool = False
    full_sync: bool = False

    @model_validator(mode="after")
    def validate_sync_mode(self):
        if self.quick_sync and self.full_sync:
            raise ValueError("quick_sync and full_sync cannot both be enabled")
        return self
