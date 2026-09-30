"""Asset synchronization reconciliation tests."""
from app.models.asset import Asset
from app.services.asset_sync import AssetSyncService
from tests.conftest import TEST_USER_ID


class _PagedImmich:
    def __init__(self, pages):
        self.pages = pages

    def list_assets(self, page=1, page_size=100, **kwargs):
        return self.pages.get(page, [])

    def is_external_library_asset(self, raw):
        return False


def _raw_asset(asset_id, asset_type, **extra):
    return {
        "id": asset_id,
        "type": asset_type,
        "originalFileName": f"{asset_id}.jpg",
        "originalMimeType": (
            "video/quicktime" if asset_type == "VIDEO" else "image/jpeg"
        ),
        **extra,
    }


def test_sync_filters_live_photo_motion_asset_after_all_pages(db):
    immich = _PagedImmich({
        1: [
            _raw_asset("motion", "VIDEO"),
            _raw_asset("standalone-video", "VIDEO"),
        ],
        2: [
            _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"still", "standalone-video"}
    assert result == {
        "synced": 2,
        "created": 2,
        "updated": 0,
        "filtered": 1,
        "errors": 0,
    }


def test_sync_filters_motion_asset_when_still_arrives_first(db):
    immich = _PagedImmich({
        1: [
            _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
            _raw_asset("standalone-video", "VIDEO"),
        ],
        2: [
            _raw_asset("motion", "VIDEO"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"still", "standalone-video"}
    assert result["synced"] == 2
    assert result["filtered"] == 1


def test_sync_keeps_non_video_asset_referenced_as_motion(db):
    immich = _PagedImmich({
        1: [
            _raw_asset("still", "IMAGE", livePhotoVideoId="referenced-image"),
            _raw_asset("referenced-image", "IMAGE"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=10)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"still", "referenced-image"}
    assert result["filtered"] == 0


def test_sync_does_not_reconcile_after_interrupted_fetch(db):
    class _InterruptedImmich(_PagedImmich):
        def list_assets(self, page=1, page_size=100, **kwargs):
            if page == 2:
                raise RuntimeError("fetch failed")
            return self.pages[page]

    immich = _InterruptedImmich({
        1: [
            _raw_asset("motion", "VIDEO"),
            _raw_asset("standalone-video", "VIDEO"),
        ],
    })
    service = AssetSyncService(db, immich, user_id=TEST_USER_ID)

    result = service.sync_all(page_size=2)

    remaining_ids = {
        asset.immich_id
        for asset in db.query(Asset).filter(Asset.user_id == TEST_USER_ID)
    }
    assert remaining_ids == {"motion", "standalone-video"}
    assert result["filtered"] == 0


def test_sync_does_not_reconcile_after_stop_request(db):
    db.add_all([
        Asset(
            id="motion-row",
            user_id=TEST_USER_ID,
            immich_id="motion",
            asset_type="VIDEO",
            raw_metadata_json={},
        ),
        Asset(
            id="still-row",
            user_id=TEST_USER_ID,
            immich_id="still",
            asset_type="IMAGE",
            raw_metadata_json={"livePhotoVideoId": "motion"},
        ),
    ])
    db.commit()
    service = AssetSyncService(
        db,
        _PagedImmich({1: []}),
        user_id=TEST_USER_ID,
    )

    result = service.sync_all(should_stop=lambda: True)

    assert db.query(Asset).filter(Asset.immich_id == "motion").count() == 1
    assert result["filtered"] == 0


def test_existing_motion_cleanup_does_not_reduce_new_retained_count(db):
    db.add(Asset(
        id="motion-row",
        user_id=TEST_USER_ID,
        immich_id="motion",
        asset_type="VIDEO",
        raw_metadata_json={},
    ))
    db.commit()
    service = AssetSyncService(
        db,
        _PagedImmich({
            1: [_raw_asset("still", "IMAGE", livePhotoVideoId="motion")],
        }),
        user_id=TEST_USER_ID,
    )

    result = service.sync_all(page_size=10)

    assert result == {
        "synced": 1,
        "created": 1,
        "updated": 0,
        "filtered": 1,
        "errors": 0,
    }


def test_multiple_albums_reconcile_once_after_all_albums(db):
    class _AlbumImmich:
        def list_album_assets(self, album_id, page=1, page_size=100):
            assets = {
                "still-album": [
                    _raw_asset("still", "IMAGE", livePhotoVideoId="motion"),
                ],
                "motion-album": [_raw_asset("motion", "VIDEO")],
            }
            return assets[album_id] if page == 1 else []

        def is_external_library_asset(self, raw):
            return False

    log_lines = []
    service = AssetSyncService(db, _AlbumImmich(), user_id=TEST_USER_ID)

    result = service.sync_albums(
        ["still-album", "motion-album"],
        page_size=10,
        job_progress_callback=log_lines.append,
    )

    assert result["synced"] == 1
    assert result["filtered"] == 1
    assert [
        line for line in log_lines
        if line.startswith("Filtered ")
    ] == ["Filtered 1 linked Live Photo motion asset(s)"]


def test_live_photo_cleanup_is_scoped_to_current_user(db):
    other_user_asset = Asset(
        id="other-motion-row",
        user_id="other-user",
        immich_id="other-motion",
        asset_type="VIDEO",
        raw_metadata_json={},
    )
    other_user_still = Asset(
        id="other-still-row",
        user_id="other-user",
        immich_id="other-still",
        asset_type="IMAGE",
        raw_metadata_json={"livePhotoVideoId": "other-motion"},
    )
    db.add_all([other_user_asset, other_user_still])
    db.commit()
    service = AssetSyncService(
        db,
        _PagedImmich({1: []}),
        user_id=TEST_USER_ID,
    )

    service.sync_all(page_size=2)

    assert db.query(Asset).filter(
        Asset.user_id == "other-user",
        Asset.immich_id == "other-motion",
    ).count() == 1
