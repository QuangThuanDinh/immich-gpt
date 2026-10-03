from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


TRASH_DESTINATION = "__trash__"


class RoutingEvaluationItemInput(BaseModel):
    id: Optional[str] = None
    immich_id: str = Field(min_length=1, max_length=255)
    expected_tag: Optional[str] = Field(default=None, max_length=255)
    expected_absent_tag: Optional[str] = Field(default=None, max_length=255)
    expected_destination: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("immich_id")
    @classmethod
    def validate_immich_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Image ID is required")
        return value

    @field_validator("expected_tag", "expected_absent_tag")
    @classmethod
    def validate_expected_tag(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        tags = [tag.strip() for tag in value.split(",")]
        if all(not tag for tag in tags):
            return None
        if any(not tag for tag in tags):
            raise ValueError("Expected tags must not contain empty entries")
        if any(any(char.isspace() for char in tag) for tag in tags):
            raise ValueError("Each expected tag must not contain spaces")
        return ",".join(tags)

    @field_validator("expected_destination")
    @classmethod
    def normalize_expected_destination(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class RoutingEvaluationSaveRequest(BaseModel):
    items: List[RoutingEvaluationItemInput] = Field(default_factory=list, max_length=100)


class RoutingEvaluationItemOut(BaseModel):
    id: str
    immich_id: str
    expected_tag: Optional[str]
    expected_absent_tag: Optional[str]
    expected_destination: Optional[str]
    result_description: Optional[str]
    result_tags: List[str] = Field(default_factory=list)
    result_destination: Optional[str]
    result_disposition: Optional[str]
    tag_matched: Optional[bool]
    absent_tag_matched: Optional[bool]
    destination_matched: Optional[bool]
    score: Optional[float]
    max_score: Optional[float]
    error_message: Optional[str]
    evaluated_at: Optional[datetime]


class RoutingEvaluationOut(BaseModel):
    items: List[RoutingEvaluationItemOut] = Field(default_factory=list)
    total_score: Optional[float] = None
    max_score: Optional[float] = None
    evaluated_at: Optional[datetime] = None
