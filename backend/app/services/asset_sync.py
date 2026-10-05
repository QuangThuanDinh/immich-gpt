"""
Asset sync service: pulls assets from Immich and stores them locally.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable, Set, Tuple
from sqlalchemy.orm import Session

from ..models.asset import Asset
from ..services.immich_client import ImmichClient
from datetime import timezone


def _parse_dt(val: Any) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None


class AssetSyncService:
    def __init__(
        self,
        db: Session,
        immich_client: Optional[ImmichClient] = None,
        user_id: Optional[str] = None,
    ):
        self.db = db
        self.immich = immich_client or ImmichClient()
        self.user_id = user_id

    def sync_all(
        self,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Dict[str, int]:
        """Sync all assets from Immich."""
        result, completed, created_ids, updated_ids = self._sync_paged(
            fetch_fn=lambda page: self.immich.list_assets(page=page, page_size=page_size),
            job_progress_callback=job_progress_callback,
            page_size=page_size,
            should_stop=should_stop,
        )
        return self._finish_sync(
            result,
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
        )

    def sync_favorites(
        self,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Dict[str, int]:
        """Sync only favorited assets from Immich."""
        result, completed, created_ids, updated_ids = self._sync_paged(
            fetch_fn=lambda page: self.immich.list_assets(
                page=page, page_size=page_size, is_favorite=True
            ),
            job_progress_callback=job_progress_callback,
            page_size=page_size,
            should_stop=should_stop,
        )
        return self._finish_sync(
            result,
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
        )

    def sync_album(
        self,
        album_id: str,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Dict[str, int]:
        """Sync assets from a specific album."""
        result, completed, created_ids, updated_ids = self._sync_paged(
            fetch_fn=lambda page: self.immich.list_album_assets(
                album_id=album_id, page=page, page_size=page_size
            ),
            job_progress_callback=job_progress_callback,
            page_size=page_size,
            should_stop=should_stop,
        )
        return self._finish_sync(
            result,
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
        )

    def sync_albums(
        self,
        album_ids: List[str],
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Dict[str, int]:
        """Sync assets from multiple albums."""
        total_created = total_updated = total_errors = 0
        created_ids: Set[str] = set()
        updated_ids: Set[str] = set()
        completed = True
        for album_id in album_ids:
            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                completed = False
                break
            if job_progress_callback:
                job_progress_callback(f"Syncing album {album_id}")
            result, album_completed, album_created_ids, album_updated_ids = (
                self._sync_paged(
                    fetch_fn=lambda page, current_album_id=album_id: (
                        self.immich.list_album_assets(
                            album_id=current_album_id,
                            page=page,
                            page_size=page_size,
                        )
                    ),
                    job_progress_callback=job_progress_callback,
                    page_size=page_size,
                    should_stop=should_stop,
                )
            )
            total_created += result["created"]
            total_updated += result["updated"]
            total_errors += result["errors"]
            created_ids.update(album_created_ids)
            updated_ids.update(album_updated_ids)
            if not album_completed:
                completed = False
                break

        return self._finish_sync(
            {
                "created": total_created,
                "updated": total_updated,
                "errors": total_errors,
            },
            completed,
            created_ids,
            updated_ids,
            job_progress_callback,
            page_size,
            should_stop,
        )

    def _finish_sync(
        self,
        result: Dict[str, int],
        completed: bool,
        created_ids: Set[str],
        updated_ids: Set[str],
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Dict[str, int]:
        filtered_ids: Set[str] = set()
        if completed:
            try:
                trashed_motion_ids, trash_lookup_completed = (
                    self._collect_trashed_live_photo_motion_ids(
                        page_size=page_size,
                        should_stop=should_stop,
                        job_progress_callback=job_progress_callback,
                    )
                )
            except Exception as e:
                result["errors"] += 1
                trash_lookup_completed = False
                if job_progress_callback:
                    job_progress_callback(
                        f"Error fetching trashed asset relationships: {e}"
                    )

            if trash_lookup_completed:
                filtered_ids = self._remove_live_photo_motion_assets(
                    trashed_motion_ids
                )
                if filtered_ids and job_progress_callback:
                    job_progress_callback(
                        f"Filtered {len(filtered_ids)} linked Live Photo motion asset(s)"
                    )

        result["created"] -= len(filtered_ids & created_ids)
        result["updated"] -= len(filtered_ids & updated_ids)
        result["synced"] = result["created"] + result["updated"]
        result["filtered"] = len(filtered_ids)
        return result

    def _collect_trashed_live_photo_motion_ids(
        self,
        page_size: int,
        should_stop: Optional[Callable[[], bool]] = None,
        job_progress_callback=None,
    ) -> Tuple[Set[str], bool]:
        motion_ids: Set[str] = set()
        page = 1

        while True:
            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                return set(), False

            if job_progress_callback:
                job_progress_callback(f"Fetching trashed asset relationships page {page}")
            raw_assets = self.immich.list_trashed_assets(
                page=page,
                page_size=page_size,
            )

            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                return set(), False

            for raw in raw_assets:
                motion_id = raw.get("livePhotoVideoId")
                if motion_id:
                    motion_ids.add(motion_id)

            if len(raw_assets) < page_size:
                return motion_ids, True
            page += 1

    _COMMIT_BATCH_SIZE = 100
    _DETAIL_FETCH_CONCURRENCY = 8

    def _sync_paged(
        self,
        fetch_fn,
        job_progress_callback=None,
        page_size: int = 100,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> Tuple[Dict[str, int], bool, Set[str], Set[str]]:
        created = updated = errors = 0
        created_ids: Set[str] = set()
        updated_ids: Set[str] = set()
        page = 1
        synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
        pending = 0  # rows flushed but not yet committed
        completed = False

        while True:
            # Cooperative stop check (pause/cancel)
            if should_stop and should_stop():
                if job_progress_callback:
                    job_progress_callback("Sync stopped due to pause/cancel request.")
                break

            if job_progress_callback:
                job_progress_callback(f"Fetching page {page}")
            try:
                raw_assets = fetch_fn(page)
            except Exception as e:
                if job_progress_callback:
                    job_progress_callback(f"Error fetching page {page}: {e}")
                break

            if not raw_assets:
                completed = True
                break

            workers = min(self._DETAIL_FETCH_CONCURRENCY, len(raw_assets))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                detail_futures = [
                    executor.submit(self.immich.get_asset, raw["id"])
                    for raw in raw_assets
                ]

            for raw, detail_future in zip(raw_assets, detail_futures):
                try:
                    detailed = detail_future.result()
                    hydrated = {**raw, **detailed}
                    c, u, asset_id = self._upsert_asset(hydrated, synced_at)
                    created += c
                    updated += u
                    if asset_id:
                        if c:
                            created_ids.add(asset_id)
                        elif u:
                            updated_ids.add(asset_id)
                    pending += 1
                except Exception as exc:
                    errors += 1
                    if job_progress_callback:
                        raw_id = raw.get("id", "unknown")
                        job_progress_callback(
                            f"Error syncing asset {raw_id}: {exc}"
                        )

                if pending >= self._COMMIT_BATCH_SIZE:
                    self.db.commit()
                    pending = 0

            if len(raw_assets) < page_size:
                completed = True
                break
            page += 1

        # Commit any remaining rows
        if pending:
            self.db.commit()

        return (
            {
                "created": created,
                "updated": updated,
                "errors": errors,
            },
            completed,
            created_ids,
            updated_ids,
        )

    def _remove_live_photo_motion_assets(
        self,
        additional_motion_ids: Optional[Set[str]] = None,
    ) -> Set[str]:
        query = self.db.query(Asset)
        if self.user_id:
            query = query.filter(Asset.user_id == self.user_id)
        assets = query.all()
        motion_assets = {
            (asset.user_id, metadata.get("livePhotoVideoId"))
            for asset in assets
            if isinstance((metadata := asset.raw_metadata_json), dict)
            and metadata.get("livePhotoVideoId")
        }
        motion_assets.update(
            (self.user_id, motion_id)
            for motion_id in (additional_motion_ids or set())
        )
        if not motion_assets:
            return set()

        companions = [
            asset for asset in assets
            if (asset.user_id, asset.immich_id) in motion_assets
            and asset.asset_type == "VIDEO"
        ]
        companion_ids = {asset.id for asset in companions}
        for companion in companions:
            self.db.delete(companion)
        if companions:
            self.db.commit()
        return companion_ids

    def _upsert_asset(self, raw: Dict[str, Any], synced_at: datetime):
        immich_id = raw.get("id")
        if not immich_id:
            return 0, 0, None

        q = self.db.query(Asset).filter(Asset.immich_id == immich_id)
        if self.user_id:
            q = q.filter(Asset.user_id == self.user_id)
        existing = q.first()
        exif = raw.get("exifInfo") or {}
        tags = [t.get("name") for t in (raw.get("tags") or []) if t.get("name")]
        people = []
        for person in raw.get("people") or []:
            person_id = person.get("id")
            if not person_id:
                continue
            people.append({
                "id": person_id,
                "name": person.get("name") or "Unnamed person",
                "is_hidden": bool(person.get("isHidden", False)),
                "is_favorite": bool(person.get("isFavorite", False)),
            })

        data = {
            "immich_id": immich_id,
            "original_filename": raw.get("originalFileName"),
            "file_created_at": _parse_dt(raw.get("fileCreatedAt")),
            "file_modified_at": _parse_dt(raw.get("fileModifiedAt")),
            "local_date_time": _parse_dt(raw.get("localDateTime")),
            "asset_type": raw.get("type"),
            "mime_type": raw.get("originalMimeType"),
            "duration": raw.get("duration"),
            "is_favorite": raw.get("isFavorite", False),
            "is_archived": raw.get("isArchived", False),
            "is_trashed": raw.get("isTrashed", False),
            "is_external_library": self.immich.is_external_library_asset(raw),
            "city": exif.get("city"),
            "country": exif.get("country"),
            "camera_make": exif.get("make"),
            "camera_model": exif.get("model"),
            "description": raw.get("exifInfo", {}).get("description") if raw.get("exifInfo") else None,
            "tags_json": tags,
            "people_json": people,
            "album_ids_json": [a.get("id") for a in (raw.get("albums") or []) if a.get("id")],
            "raw_metadata_json": raw,
            "synced_at": synced_at,
        }

        if existing:
            for k, v in data.items():
                setattr(existing, k, v)
            return 0, 1, existing.id
        else:
            asset = Asset(id=str(uuid.uuid4()), user_id=self.user_id, **data)
            self.db.add(asset)
            return 1, 0, asset.id
