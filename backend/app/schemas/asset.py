from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class AssetPersonOut(BaseModel):
    id: str
    name: str
    is_hidden: bool = False
    is_favorite: bool = False


class AssetFaceOut(BaseModel):
    id: str
    bounding_box_x1: int
    bounding_box_y1: int
    bounding_box_x2: int
    bounding_box_y2: int
    image_width: int
    image_height: int
    source_type: Optional[str] = None
    person_id: Optional[str] = None
    person_name: Optional[str] = None


class AssetOut(BaseModel):
    id: str
    immich_id: str
    original_filename: Optional[str]
    file_created_at: Optional[datetime]
    asset_type: Optional[str]
    mime_type: Optional[str]
    city: Optional[str]
    country: Optional[str]
    camera_make: Optional[str]
    camera_model: Optional[str]
    description: Optional[str]
    tags: Optional[List[str]]
    people: Optional[List[AssetPersonOut]]
    faces: Optional[List[AssetFaceOut]]
    album_ids: Optional[List[str]]
    is_favorite: bool
    is_archived: bool
    is_external_library: bool
    synced_at: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetSyncResult(BaseModel):
    synced: int
    created: int
    updated: int
    errors: int
