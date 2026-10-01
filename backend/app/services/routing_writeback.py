"""
RoutingWritebackService — applies routing plan items back to Immich.
Wraps the existing ImmichClient and uses leaf settings only.
"""
from __future__ import annotations
import uuid
from typing import Optional, Dict, List

from sqlalchemy.orm import Session

from ..models.bucket import Bucket
from ..models.asset import Asset
from ..models.routing_plan import RoutingPlanItem
from ..models.audit_log import AuditLog
from .immich_client import ImmichClient, ImmichError


class RoutingWritebackResult:
    def __init__(self, item_id: str):
        self.item_id = item_id
        self.album_assigned = False
        self.trashed = False
        self.description_written = False
        self.tags_written = False
        self.location_written = False
        self.errors: List[str] = []

    def to_dict(self) -> Dict:
        return {
            "item_id": self.item_id,
            "album_assigned": self.album_assigned,
            "trashed": self.trashed,
            "description_written": self.description_written,
            "tags_written": self.tags_written,
            "location_written": self.location_written,
            "errors": self.errors,
        }


class RoutingWritebackService:
    def __init__(
        self,
        db: Session,
        user_id: str,
        immich_client: Optional[ImmichClient] = None,
    ):
        self.db = db
        self.user_id = user_id
        self.immich = immich_client or ImmichClient()

    def apply_item(self, item: RoutingPlanItem) -> RoutingWritebackResult:
        item_id = item.id
        result = RoutingWritebackResult(item_id)
        asset = self.db.query(Asset).filter(
            Asset.id == item.asset_id,
            Asset.user_id == self.user_id,
        ).first()
        if not asset:
            result.errors.append("Asset not found")
            self.db.rollback()
            return result

        leaf: Optional[Bucket] = None
        if item.primary_bucket_id:
            leaf = (
                self.db.query(Bucket)
                .filter(Bucket.id == item.primary_bucket_id, Bucket.user_id == self.user_id)
                .first()
            )
        if not leaf:
            result.errors.append("Routing leaf missing or no longer available")
            self.db.rollback()
            return result

        destination = leaf.destination_type or "virtual"
        asset_id = asset.id
        immich_id = asset.immich_id
        leaf_id = leaf.id
        leaf_path = leaf.path
        write_description = bool(leaf.write_description)
        write_tags = bool(leaf.write_tags)
        write_location = bool(leaf.write_location)
        description = item.suggested_description
        tags = list(item.suggested_tags_json or [])
        location = dict(item.suggested_location_json or {})
        album_name = leaf.immich_album_name or leaf.path or leaf.name
        target_album_id: Optional[str] = leaf.immich_album_id
        create_album_if_missing = bool(leaf.create_album_if_missing)

        self.db.rollback()

        # Description
        if write_description and description:
            try:
                self.immich.update_asset_description(immich_id, description)
                result.description_written = True
                self._audit(asset_id, "routing_writeback_description", "success")
            except ImmichError as e:
                msg = f"Failed to write description: {e}"
                result.errors.append(msg)
                self._audit(asset_id, "routing_writeback_description", "failed", error=msg)

        # Tags
        if write_tags and tags:
            try:
                tag_objects = self.immich.get_or_create_tags(tags)
                if tag_objects:
                    self.immich.tag_asset(immich_id, [t["id"] for t in tag_objects])
                    result.tags_written = True
                    self._audit(asset_id, "routing_writeback_tags", "success",
                                {"count": len(tag_objects)})
            except ImmichError as e:
                msg = f"Failed to write tags: {e}"
                result.errors.append(msg)
                self._audit(asset_id, "routing_writeback_tags", "failed", error=msg)

        # Location
        if write_location and location:
            lat = location.get("latitude")
            lon = location.get("longitude")
            if lat is not None and lon is not None:
                try:
                    self.immich.update_asset_location(immich_id, float(lat), float(lon))
                    result.location_written = True
                    self._audit(asset_id, "routing_writeback_location", "success",
                                {"lat": lat, "lon": lon})
                except (ImmichError, TypeError, ValueError) as e:
                    msg = f"Failed to write location: {e}"
                    result.errors.append(msg)
                    self._audit(asset_id, "routing_writeback_location", "failed", error=msg)

        # Destination-specific action
        if destination == "immich_trash":
            try:
                self.immich.trash_assets([immich_id])
                result.trashed = True
                self._audit(asset_id, "routing_writeback_trash", "success",
                            {"path": leaf_path})
            except ImmichError as e:
                msg = f"Failed to trash asset: {e}"
                result.errors.append(msg)
                self._audit(asset_id, "routing_writeback_trash", "failed", error=msg)
        elif destination == "immich_album":
            if not target_album_id:
                if create_album_if_missing:
                    try:
                        album = self.immich.get_or_create_album(album_name)
                        target_album_id = album.get("id") if album else None
                        if target_album_id:
                            self._save_album_id(leaf_id, target_album_id)
                    except ImmichError as e:
                        msg = f"Failed to create album '{album_name}': {e}"
                        result.errors.append(msg)
                        self._audit(asset_id, "routing_writeback_album", "failed", error=msg)
                else:
                    album = self.immich.get_existing_album(album_name)
                    if album:
                        target_album_id = album.get("id")
                        self._save_album_id(leaf_id, target_album_id)
                    else:
                        msg = (
                            f"Album '{album_name}' not found and create_album_if_missing=false"
                        )
                        result.errors.append(msg)
                        self._audit(asset_id, "routing_writeback_album", "failed", error=msg)
            if target_album_id:
                try:
                    self.immich.add_asset_to_album(target_album_id, [immich_id])
                    result.album_assigned = True
                    self._audit(asset_id, "routing_writeback_album", "success",
                                {"album_id": target_album_id, "album_name": album_name})
                except ImmichError as e:
                    msg = f"Failed to add asset to album: {e}"
                    result.errors.append(msg)
                    self._audit(asset_id, "routing_writeback_album", "failed", error=msg)
        # virtual / review_only — no Immich-side action

        return result

    def _save_album_id(self, leaf_id: str, album_id: str) -> None:
        leaf = self.db.query(Bucket).filter(
            Bucket.id == leaf_id,
            Bucket.user_id == self.user_id,
        ).first()
        if leaf:
            leaf.immich_album_id = album_id
            self.db.commit()

    def _audit(
        self,
        asset_id: str,
        action: str,
        status: str,
        details: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> None:
        log = AuditLog(
            id=str(uuid.uuid4()),
            user_id=self.user_id,
            asset_id=asset_id,
            action=action,
            status=status,
            details_json=details,
            error_message=error,
            source="routing_writeback",
            level="info" if status == "success" else "error",
        )
        self.db.add(log)
        self.db.commit()
