"""Test 2: metadata inclusion in provider request + ImmichClient behavior."""
import pytest
from unittest.mock import MagicMock, patch
import httpx
from app.services.immich_client import ImmichClient, ImmichError


def make_mock_response(status_code: int, json_data=None, content=b""):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
    resp.content = content
    resp.text = str(json_data)
    return resp


def test_check_connectivity_success():
    client = ImmichClient("http://immich.local", "test-key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.side_effect = [
        make_mock_response(200, {"res": "pong"}),
        make_mock_response(200, {"version": "1.0"}),
    ]

    with patch.object(client, "_client", return_value=mock_http):
        result = client.check_connectivity()
    assert result["connected"] is True


def test_check_connectivity_failure_raises():
    client = ImmichClient("http://bad-host", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(401, {"message": "Unauthorized"})

    with patch.object(client, "_client", return_value=mock_http):
        with pytest.raises(ImmichError):
            client.check_connectivity()


def test_get_thumbnail_returns_bytes():
    client = ImmichClient("http://immich.local", "key")
    fake_bytes = b"\xff\xd8\xff\xe0test"
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(200, content=fake_bytes)

    with patch.object(client, "_client", return_value=mock_http):
        result = client.get_thumbnail("asset-123")
    assert result == fake_bytes


def test_get_asset_faces_returns_face_regions():
    client = ImmichClient("http://immich.local", "key")
    faces = [{"id": "face-1", "boundingBoxX1": 10}]
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(200, faces)

    with patch.object(client, "_client", return_value=mock_http):
        result = client.get_asset_faces("asset-123")

    assert result == faces
    mock_http.get.assert_called_once_with(
        "/api/faces",
        params={"id": "asset-123"},
    )


def test_get_asset_faces_rejects_invalid_response():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(200, {"faces": []})

    with patch.object(client, "_client", return_value=mock_http):
        with pytest.raises(ImmichError, match="Invalid face response"):
            client.get_asset_faces("asset-123")


def test_get_asset_faces_retries_transient_transport_error():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.side_effect = [
        httpx.ConnectError("connection refused"),
        make_mock_response(200, []),
    ]

    with patch.object(client, "_client", return_value=mock_http):
        with patch("app.services.immich_client.time.sleep") as sleep:
            assert client.get_asset_faces("asset-123") == []

    assert mock_http.get.call_count == 2
    sleep.assert_called_once_with(0.5)


def test_get_asset_faces_retries_transient_server_error():
    client = ImmichClient("http://immich.local", "key")
    unavailable = make_mock_response(503, {"message": "Unavailable"})
    success = make_mock_response(200, [])
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.side_effect = [unavailable, success]

    with patch.object(client, "_client", return_value=mock_http):
        with patch("app.services.immich_client.time.sleep") as sleep:
            assert client.get_asset_faces("asset-123") == []

    unavailable.close.assert_called_once()
    sleep.assert_called_once_with(0.5)


def test_get_asset_faces_raises_after_retry_limit():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.side_effect = httpx.ConnectError("connection refused")

    with patch.object(client, "_client", return_value=mock_http):
        with patch("app.services.immich_client.time.sleep") as sleep:
            with pytest.raises(httpx.ConnectError, match="connection refused"):
                client.get_asset_faces("asset-123")

    assert mock_http.get.call_count == 4
    assert [call.args[0] for call in sleep.call_args_list] == [0.5, 1.0, 2.0]


def test_get_thumbnail_raises_on_404():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(404, {"error": "Not found"})

    with patch.object(client, "_client", return_value=mock_http):
        with pytest.raises(ImmichError, match="Thumbnail unavailable"):
            client.get_thumbnail("missing-asset")


def test_get_person_thumbnail_returns_bytes():
    client = ImmichClient("http://immich.local", "key")
    fake_bytes = b"\xff\xd8\xff\xe0face"
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(200, content=fake_bytes)

    with patch.object(client, "_client", return_value=mock_http):
        result = client.get_person_thumbnail("person-123")

    assert result == fake_bytes
    mock_http.get.assert_called_once_with(
        "/api/people/person-123/thumbnail",
        headers={"x-api-key": "key", "Accept": "image/*"},
    )


def test_get_person_thumbnail_raises_on_error():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(404, {"error": "Not found"})

    with patch.object(client, "_client", return_value=mock_http):
        with pytest.raises(ImmichError, match="Person thumbnail unavailable"):
            client.get_person_thumbnail("missing-person")


def test_api_key_sent_in_header():
    """Verify credentials are sent in headers, not in URL."""
    client = ImmichClient("http://immich.local", "my-secret-key")
    http_client = client._client()
    try:
        assert http_client.headers.get("x-api-key") == "my-secret-key"
        # Key should not be in the base URL
        assert "my-secret-key" not in str(http_client.base_url)
    finally:
        http_client.close()


def test_context_manager_reuses_single_http_client():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.get.side_effect = [
        make_mock_response(200, {"total": 1}),
        make_mock_response(200, [{"id": "album-1"}]),
    ]

    with patch.object(client, "_client", return_value=mock_http) as make_client:
        with client:
            assert client.get_asset_count() == 1
            assert client.list_albums() == [{"id": "album-1"}]

    make_client.assert_called_once()
    mock_http.close.assert_called_once()


def test_list_assets_uses_created_window_for_quick_sync():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.post.return_value = make_mock_response(
        200,
        {"assets": {"items": [{"id": "new-asset"}]}},
    )

    with patch.object(client, "_client", return_value=mock_http):
        result = client.list_assets(
            page=1,
            page_size=25,
            created_after="2026-10-08T17:55:00Z",
            created_before="2026-10-08T19:00:00Z",
        )

    assert result == [{"id": "new-asset"}]
    mock_http.post.assert_called_once_with(
        "/api/search/metadata",
        json={
            "page": 1,
            "size": 25,
            "withExif": True,
            "withArchived": True,
            "createdAfter": "2026-10-08T17:55:00Z",
            "order": "asc",
            "createdBefore": "2026-10-08T19:00:00Z",
        },
    )


def test_list_album_assets_caches_full_album_payload():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.get.return_value = make_mock_response(
        200,
        {
            "assets": [
                {"id": "asset-1"},
                {"id": "asset-2"},
                {"id": "asset-3"},
            ]
        },
    )

    with patch.object(client, "_client", return_value=mock_http):
        first = client.list_album_assets("album-1", page=1, page_size=2)
        second = client.list_album_assets("album-1", page=2, page_size=2)

    assert first == [{"id": "asset-1"}, {"id": "asset-2"}]
    assert second == [{"id": "asset-3"}]
    mock_http.get.assert_called_once_with(
        "/api/albums/album-1",
        params={"withoutAssets": False},
    )


def test_list_trashed_assets_uses_deleted_search_filter():
    client = ImmichClient("http://immich.local", "key")
    mock_http = MagicMock()
    mock_http.__enter__ = lambda self: self
    mock_http.__exit__ = MagicMock(return_value=False)
    mock_http.post.return_value = make_mock_response(
        200,
        {"assets": {"items": [{"id": "trashed-still"}]}},
    )

    with patch.object(client, "_client", return_value=mock_http):
        result = client.list_trashed_assets(page=2, page_size=25)

    assert result == [{"id": "trashed-still"}]
    mock_http.post.assert_called_once_with(
        "/api/search/metadata",
        json={
            "page": 2,
            "size": 25,
            "withExif": True,
            "withArchived": True,
            "withDeleted": True,
            "trashedAfter": "1970-01-01T00:00:00.000Z",
        },
    )


def test_is_external_library_asset_detection():
    client = ImmichClient("http://immich.local", "key")
    external_asset = {"library": {"type": "EXTERNAL"}}
    internal_asset = {"library": {"type": "UPLOAD"}}
    no_lib_asset = {}

    assert client.is_external_library_asset(external_asset) is True
    assert client.is_external_library_asset(internal_asset) is False
    assert client.is_external_library_asset(no_lib_asset) is False
