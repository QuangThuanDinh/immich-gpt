"""RoutingPlanService and routing API tests."""
import uuid
import pytest
from contextlib import nullcontext
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from app.models.asset import Asset
from app.config import settings
from app.models.app_setting import AppSetting
from app.models.prompt_run import PromptRun
from app.models.routing_plan import RoutingPlan, RoutingPlanItem
from app.services.secret_store import encrypt_secret
from app.services.routing_plan_service import RoutingPlanService
from app.services.routing_tree import RoutingTreeService
from app.services.routing_classification import RoutingClassificationOrchestrator
from app.services.routing_writeback import RoutingWritebackService
from app.services.routing_schemas import (
    RoutingDecision, Candidate,
)
from app.schemas.bucket import RoutingNodeCreate
from app.models.bucket import Bucket
from app.models.asset import Asset
from tests.conftest import TEST_USER_ID


def _clean(db):
    db.query(Bucket).filter(Bucket.user_id == TEST_USER_ID).delete()
    db.commit()


def _make_decision(bucket_id: str, path: str, confidence: float = 0.9, review: bool = False, auto: bool = False) -> RoutingDecision:
    return RoutingDecision(
        primary=Candidate(bucket_id=bucket_id, path=path, confidence=confidence),
        secondary=[],
        disposition="keep",
        review_required=review,
        auto_apply=auto,
    )


def _make_asset(db, asset_id: str, immich_id: str) -> Asset:
    asset = Asset(
        id=asset_id,
        user_id=TEST_USER_ID,
        immich_id=immich_id,
        original_filename=f"{immich_id}.jpg",
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


class _DummyProvider:
    provider_name = "dummy"


def _make_asset(db, immich_id: str) -> Asset:
    asset = Asset(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        immich_id=immich_id,
        original_filename=f"{immich_id}.jpg",
        synced_at=datetime.utcnow(),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


class _FakeProvider:
    provider_name = "fake"
    model = "fake-model"

    def classify_routing(self, messages, image_payload):
        raise AssertionError("Provider should not be called by _load_assets tests")


def _make_orchestrator(db) -> RoutingClassificationOrchestrator:
    return RoutingClassificationOrchestrator(
        db,
        _FakeProvider(),
        user_id=TEST_USER_ID,
        immich_client=object(),
    )


def test_plan_apply_uses_current_users_saved_immich_connection(db, monkeypatch):
    from app.routers import routing

    db.add_all([
        AppSetting(
            id=str(uuid.uuid4()),
            user_id=TEST_USER_ID,
            key="immich_url",
            value="https://immich.example.com",
        ),
        AppSetting(
            id=str(uuid.uuid4()),
            user_id=TEST_USER_ID,
            key="immich_api_key",
            value=encrypt_secret("saved-api-key"),
        ),
        RoutingPlan(
            id="plan-with-user-connection",
            user_id=TEST_USER_ID,
            status="ready",
        ),
        RoutingPlanItem(
            id="previously-approved-item",
            user_id=TEST_USER_ID,
            plan_id="plan-with-user-connection",
            asset_id="local-asset-id",
            status="approved",
        ),
    ])
    db.commit()
    immich_client = object()
    client_factory = MagicMock(return_value=immich_client)
    writeback = MagicMock()
    writeback.apply_item.return_value = SimpleNamespace(errors=[])
    writeback_factory = MagicMock(return_value=writeback)
    monkeypatch.setattr(routing, "ImmichClient", client_factory)
    monkeypatch.setattr(routing, "RoutingWritebackService", writeback_factory)

    result = routing.plan_apply(
        "plan-with-user-connection",
        db=db,
        current_user=SimpleNamespace(id=TEST_USER_ID),
    )

    client_factory.assert_called_once_with(
        "https://immich.example.com",
        "saved-api-key",
    )
    writeback_factory.assert_called_once_with(
        db,
        TEST_USER_ID,
        immich_client,
    )
    assert result == {"applied": 1, "failed": 0}


def test_plan_approve_applies_selected_pending_items_immediately(
    client,
    db,
    monkeypatch,
):
    from app.routers import routing

    plan = RoutingPlan(
        id="immediate-approval-plan",
        user_id=TEST_USER_ID,
        status="ready",
    )
    item = RoutingPlanItem(
        id="pending-item",
        user_id=TEST_USER_ID,
        plan_id=plan.id,
        asset_id="local-asset-id",
        status="pending",
    )
    db.add_all([plan, item])
    db.commit()
    immich_client = object()
    writeback = MagicMock()
    writeback.apply_item.return_value = SimpleNamespace(errors=[])
    writeback_factory = MagicMock(return_value=writeback)
    monkeypatch.setattr(
        routing,
        "_get_user_immich_client",
        lambda *_: immich_client,
    )
    monkeypatch.setattr(routing, "RoutingWritebackService", writeback_factory)

    response = client.post(
        f"/api/routing/plans/{plan.id}/approve",
        json={"item_ids": [item.id]},
    )

    assert response.status_code == 200
    assert response.json() == {"approved": 1, "applied": 1, "failed": 0}
    db.refresh(item)
    assert item.status == "applied"
    writeback.apply_item.assert_called_once()


def test_plan_approve_reports_writeback_failure(client, db, monkeypatch):
    from app.routers import routing

    plan = RoutingPlan(
        id="failed-approval-plan",
        user_id=TEST_USER_ID,
        status="ready",
    )
    item = RoutingPlanItem(
        id="failed-approval-item",
        user_id=TEST_USER_ID,
        plan_id=plan.id,
        asset_id="local-asset-id",
        status="pending",
    )
    db.add_all([plan, item])
    db.commit()
    writeback = MagicMock()
    writeback.apply_item.return_value = SimpleNamespace(
        errors=["Failed to write tags"],
    )
    monkeypatch.setattr(
        routing,
        "_get_user_immich_client",
        lambda *_: object(),
    )
    monkeypatch.setattr(
        routing,
        "RoutingWritebackService",
        MagicMock(return_value=writeback),
    )

    response = client.post(
        f"/api/routing/plans/{plan.id}/approve",
        json={"item_ids": [item.id]},
    )

    assert response.status_code == 200
    assert response.json() == {"approved": 1, "applied": 0, "failed": 1}
    db.refresh(item)
    assert item.status == "failed"
    assert item.error_message == "Failed to write tags"


def test_plan_approve_retries_failed_item(client, db, monkeypatch):
    from app.routers import routing

    plan = RoutingPlan(
        id="retry-failed-plan",
        user_id=TEST_USER_ID,
        status="partially_applied",
    )
    item = RoutingPlanItem(
        id="failed-item",
        user_id=TEST_USER_ID,
        plan_id=plan.id,
        asset_id="local-asset-id",
        status="failed",
        error_message="Previous failure",
    )
    db.add_all([plan, item])
    db.commit()
    writeback = MagicMock()
    writeback.apply_item.return_value = SimpleNamespace(errors=[])
    monkeypatch.setattr(
        routing,
        "_get_user_immich_client",
        lambda *_: object(),
    )
    monkeypatch.setattr(
        routing,
        "RoutingWritebackService",
        MagicMock(return_value=writeback),
    )

    response = client.post(
        f"/api/routing/plans/{plan.id}/approve",
        json={"item_ids": [item.id]},
    )

    assert response.status_code == 200
    assert response.json() == {"approved": 1, "applied": 1, "failed": 0}
    db.refresh(item)
    assert item.status == "applied"
    assert item.error_message is None
    writeback.apply_item.assert_called_once()


def test_plan_reject_finalizes_failed_item_without_writeback(
    client,
    db,
    monkeypatch,
):
    from app.routers import routing

    plan = RoutingPlan(
        id="reject-failed-plan",
        user_id=TEST_USER_ID,
        status="partially_applied",
    )
    item = RoutingPlanItem(
        id="failed-rejection-item",
        user_id=TEST_USER_ID,
        plan_id=plan.id,
        asset_id="local-asset-id",
        status="failed",
        error_message="Previous failure",
    )
    db.add_all([plan, item])
    db.commit()
    client_factory = MagicMock(side_effect=AssertionError(
        "Reject must not connect to Immich"
    ))
    monkeypatch.setattr(routing, "_get_user_immich_client", client_factory)

    response = client.post(
        f"/api/routing/plans/{plan.id}/reject",
        json={"item_ids": [item.id]},
    )

    assert response.status_code == 200
    assert response.json() == {"rejected": 1}
    db.refresh(item)
    assert item.status == "rejected"
    assert item.error_message is None
    client_factory.assert_not_called()


def test_plan_reject_is_immediate_without_immich_writeback(
    client,
    db,
    monkeypatch,
):
    from app.routers import routing

    plan = RoutingPlan(
        id="immediate-rejection-plan",
        user_id=TEST_USER_ID,
        status="ready",
    )
    item = RoutingPlanItem(
        id="pending-rejection-item",
        user_id=TEST_USER_ID,
        plan_id=plan.id,
        asset_id="local-asset-id",
        status="pending",
    )
    db.add_all([plan, item])
    db.commit()
    client_factory = MagicMock(side_effect=AssertionError(
        "Reject must not connect to Immich"
    ))
    monkeypatch.setattr(routing, "_get_user_immich_client", client_factory)

    response = client.post(
        f"/api/routing/plans/{plan.id}/reject",
        json={"item_ids": [item.id]},
    )

    assert response.status_code == 200
    assert response.json() == {"rejected": 1}
    db.refresh(item)
    assert item.status == "rejected"
    client_factory.assert_not_called()


def test_process_asset_stops_when_image_preparation_fails(db):
    orchestrator = _make_orchestrator(db)
    asset = _make_asset(db, "asset-without-thumbnail")
    orchestrator.image_service.prepare_for_provider = MagicMock(
        side_effect=RuntimeError("thumbnail unavailable")
    )

    with pytest.raises(RuntimeError, match="thumbnail unavailable"):
        orchestrator._process_asset(asset, [], None, "job-id")


def test_process_asset_releases_transaction_during_external_calls(db):
    orchestrator = _make_orchestrator(db)
    asset = _make_asset(db, "asset-with-thumbnail")
    plan = RoutingPlanService(db, TEST_USER_ID).create_plan()
    transaction_states = []

    def prepare_image(_immich_id):
        transaction_states.append(("image", db.in_transaction()))
        return {"base64": "image"}

    def classify(_messages, _image_payload):
        transaction_states.append(("provider", db.in_transaction()))
        return {
            "disposition": "review",
            "review_required": True,
            "metadata": {},
        }

    orchestrator.image_service.prepare_for_provider = prepare_image
    orchestrator.provider.classify_routing = classify

    orchestrator._process_asset(asset, [], plan, "job-id")

    assert transaction_states == [("image", False), ("provider", False)]
    prompt_run = db.query(PromptRun).filter(
        PromptRun.asset_id == asset.id,
    ).one()
    assert prompt_run.status == "success"
    assert db.query(RoutingPlanItem).filter(
        RoutingPlanItem.asset_id == asset.id,
    ).count() == 1


def test_writeback_releases_transaction_during_immich_calls(db):
    asset = _make_asset(db, "writeback-asset")
    leaf = db.query(Bucket).filter(Bucket.user_id == TEST_USER_ID).first()
    leaf.write_description = True
    plan = RoutingPlanService(db, TEST_USER_ID).create_plan()
    item = RoutingPlanItem(
        id=str(uuid.uuid4()),
        user_id=TEST_USER_ID,
        plan_id=plan.id,
        asset_id=asset.id,
        primary_bucket_id=leaf.id,
        suggested_description="Updated description",
        status="approved",
    )
    db.add(item)
    db.commit()

    immich = MagicMock()

    def update_description(_immich_id, _description):
        assert not db.in_transaction()

    immich.update_asset_description.side_effect = update_description

    result = RoutingWritebackService(
        db,
        TEST_USER_ID,
        immich_client=immich,
    ).apply_item(item)

    assert result.description_written is True
    immich.update_asset_description.assert_called_once_with(
        asset.immich_id,
        "Updated description",
    )


def test_classification_rolls_back_before_logging_asset_failure(db):
    orchestrator = _make_orchestrator(db)
    asset = _make_asset(db, "failed-asset")
    plan = MagicMock(id="plan-id", status="draft")
    job = MagicMock(status="running")
    orchestrator.tree_service.get_enabled_leaves = MagicMock(
        return_value=[MagicMock()]
    )
    orchestrator.plan_service.create_plan = MagicMock(return_value=plan)
    orchestrator._load_assets = MagicMock(return_value=[asset])
    orchestrator._process_asset = MagicMock(
        side_effect=RuntimeError("original database failure")
    )
    orchestrator._apply_auto_apply_items = MagicMock()
    orchestrator.job_service = MagicMock()
    orchestrator.job_service.defer_commits.return_value = nullcontext()
    orchestrator.job_service.get_job.return_value = job
    original_rollback = db.rollback
    db.rollback = MagicMock(wraps=original_rollback)

    def assert_rollback_before_error_log(*args, **kwargs):
        if kwargs.get("error_delta"):
            assert db.rollback.called
            assert "original database failure" in kwargs["log_line"]

    orchestrator.job_service.update_progress.side_effect = (
        assert_rollback_before_error_log
    )

    assert orchestrator.run_classification_job("job-id") == "plan-id"
    db.rollback.assert_called_once()
    orchestrator.job_service.complete_job.assert_called_once()


def test_plan_groups_items_by_destination(db):
    _clean(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    a = svc.create_node(RoutingNodeCreate(name="A"))
    b = svc.create_node(RoutingNodeCreate(name="B"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()

    for i in range(3):
        plan_svc.add_item(
            plan,
            asset_id=f"asset-a-{i}",
            decision=_make_decision(a.id, "A", review=False),
            ai_metadata={"description": "x", "tags": []},
        )
    for i in range(2):
        plan_svc.add_item(
            plan,
            asset_id=f"asset-b-{i}",
            decision=_make_decision(b.id, "B", review=True),
            ai_metadata={},
        )

    summary = plan_svc.summarize(plan.id)
    assert summary["total"] == 5
    assert summary["page_size"] == settings.ROUTING_PLAN_PAGE_SIZE
    ready = {g["path"]: g["count"] for g in summary["groups"]["ready_to_approve"]}
    needs = {g["path"]: g["count"] for g in summary["groups"]["needs_review"]}
    assert ready.get("A") == 3
    assert needs.get("B") == 2
    assert {
        item.status for item in plan_svc.list_items(plan.id)
    } == {"pending"}


def test_only_auto_apply_decisions_start_approved(db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    bucket = tree.create_node(RoutingNodeCreate(name="A"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()

    manual = plan_svc.add_item(
        plan,
        asset_id="manual-asset",
        decision=_make_decision(bucket.id, "A", review=False, auto=False),
        ai_metadata={},
    )
    automatic = plan_svc.add_item(
        plan,
        asset_id="automatic-asset",
        decision=_make_decision(bucket.id, "A", review=False, auto=True),
        ai_metadata={},
    )

    assert manual.status == "pending"
    assert automatic.status == "approved"


def test_plan_summary_lists_enabled_writeback_operations(db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    album = tree.create_node(RoutingNodeCreate(
        name="Album",
        destination_type="immich_album",
        write_description=True,
        write_tags=False,
    ))
    trash = tree.create_node(RoutingNodeCreate(
        name="Trash",
        destination_type="immich_trash",
        write_description=False,
        write_tags=True,
    ))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    plan_svc.add_item(
        plan,
        asset_id="album-asset",
        decision=_make_decision(album.id, "Album"),
        ai_metadata={},
    )
    plan_svc.add_item(
        plan,
        asset_id="trash-asset",
        decision=_make_decision(trash.id, "Trash"),
        ai_metadata={},
    )

    summary = plan_svc.summarize(plan.id)

    assert summary["writeback"] == {
        "write_description": 1,
        "write_tags": 1,
        "move_to_album": 1,
        "move_to_trash": 1,
    }


def test_approve_and_reject_groups(db):
    _clean(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    a = svc.create_node(RoutingNodeCreate(name="A"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()

    items = []
    for i in range(3):
        items.append(plan_svc.add_item(
            plan,
            asset_id=f"asset-{i}",
            decision=_make_decision(a.id, "A", review=True),
            ai_metadata={},
        ))

    approved = plan_svc.approve_items([items[0].id, items[1].id])
    rejected = plan_svc.reject_items([items[2].id])
    assert approved == 2
    assert rejected == 1
    db.refresh(items[0]); db.refresh(items[2])
    assert items[0].status == "approved"
    assert items[2].status == "rejected"


def test_bulk_actions_only_change_pending_items(db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    bucket = tree.create_node(RoutingNodeCreate(name="A"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    approved = plan_svc.add_item(
        plan,
        asset_id="approved-asset",
        decision=_make_decision(bucket.id, "A", review=True),
        ai_metadata={},
    )
    rejected = plan_svc.add_item(
        plan,
        asset_id="rejected-asset",
        decision=_make_decision(bucket.id, "A", review=True),
        ai_metadata={},
    )
    pending_approve = plan_svc.add_item(
        plan,
        asset_id="pending-approve-asset",
        decision=_make_decision(bucket.id, "A", review=True),
        ai_metadata={},
    )
    pending_reject = plan_svc.add_item(
        plan,
        asset_id="pending-reject-asset",
        decision=_make_decision(bucket.id, "A", review=True),
        ai_metadata={},
    )
    plan_svc.approve_items([approved.id])
    plan_svc.reject_items([rejected.id])

    assert plan_svc.approve_items([
        approved.id,
        rejected.id,
        pending_approve.id,
    ]) == 1
    assert plan_svc.reject_items([
        approved.id,
        rejected.id,
        pending_reject.id,
    ]) == 1
    db.refresh(approved)
    db.refresh(rejected)
    db.refresh(pending_approve)
    db.refresh(pending_reject)
    assert approved.status == "approved"
    assert rejected.status == "rejected"
    assert pending_approve.status == "approved"
    assert pending_reject.status == "rejected"


def test_group_item_pagination_returns_exact_group(db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    bucket = tree.create_node(RoutingNodeCreate(name="A"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    for index in range(3):
        item = plan_svc.add_item(
            plan,
            asset_id=f"asset-{index}",
            decision=_make_decision(bucket.id, "A", review=True),
            ai_metadata={},
        )
        if index == 2:
            plan_svc.reject_items([item.id])

    first_page = plan_svc.list_group_items(
        plan.id,
        "needs_review",
        page=1,
        page_size=1,
        bucket_id=bucket.id,
    )
    second_page = plan_svc.list_group_items(
        plan.id,
        "needs_review",
        page=2,
        page_size=1,
        bucket_id=bucket.id,
    )
    rejected = plan_svc.list_group_items(
        plan.id,
        "rejected",
        bucket_id=bucket.id,
    )

    assert len(first_page) == 1
    assert len(second_page) == 1
    assert first_page[0].id != second_page[0].id
    assert [item.asset_id for item in rejected] == ["asset-2"]


def test_group_item_pagination_endpoint(client, db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    bucket = tree.create_node(RoutingNodeCreate(name="A"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    for index in range(2):
        plan_svc.add_item(
            plan,
            asset_id=f"endpoint-asset-{index}",
            decision=_make_decision(bucket.id, "A", review=True),
            ai_metadata={},
        )

    response = client.get(
        f"/api/routing/plans/{plan.id}/items",
        params={
            "group_key": "needs_review",
            "bucket_id": bucket.id,
            "page": 2,
            "page_size": 1,
        },
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["asset_id"] == "endpoint-asset-1"


def test_update_plan_item_persists_suggestions_and_locks_after_review(client, db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    source = tree.create_node(RoutingNodeCreate(name="Source"))
    target = tree.create_node(RoutingNodeCreate(name="Target"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    item = plan_svc.add_item(
        plan,
        asset_id="editable-asset",
        decision=_make_decision(source.id, "Source", review=True),
        ai_metadata={},
    )

    response = client.patch(
        f"/api/routing/plans/{plan.id}/items/{item.id}",
        json={
            "suggested_description": "Updated description",
            "suggested_tags": ["family", "portrait"],
            "suggested_location": {"place_name": "Hanoi"},
            "suggested_caption": "Updated caption",
            "primary_bucket_id": target.id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["suggested_description"] == "Updated description"
    assert body["suggested_tags"] == ["family", "portrait"]
    assert body["suggested_location"] == {"place_name": "Hanoi"}
    assert body["suggested_caption"] == "Updated caption"
    assert body["primary_bucket_id"] == target.id
    assert body["primary_bucket_path"] == "Target"

    plan_svc.approve_items([item.id])
    locked = client.patch(
        f"/api/routing/plans/{plan.id}/items/{item.id}",
        json={"suggested_description": "Should fail"},
    )
    assert locked.status_code == 400
    assert "pending" in locked.json()["detail"]


def test_update_plan_item_rejects_disabled_or_parent_destination(client, db):
    _clean(db)
    tree = RoutingTreeService(db, TEST_USER_ID)
    source = tree.create_node(RoutingNodeCreate(name="Source"))
    parent = tree.create_node(RoutingNodeCreate(name="Parent", is_leaf=False))
    disabled = tree.create_node(RoutingNodeCreate(name="Disabled", enabled=False))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    item = plan_svc.add_item(
        plan,
        asset_id="editable-asset",
        decision=_make_decision(source.id, "Source", review=True),
        ai_metadata={},
    )

    for destination_id in (parent.id, disabled.id):
        response = client.patch(
            f"/api/routing/plans/{plan.id}/items/{item.id}",
            json={"primary_bucket_id": destination_id},
        )
        assert response.status_code == 400


def test_plan_approve_does_not_mutate_items_from_other_plan(client, db):
    _clean(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    a = svc.create_node(RoutingNodeCreate(name="A"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan_a = plan_svc.create_plan()
    plan_b = plan_svc.create_plan()
    item_b = plan_svc.add_item(
        plan_b,
        asset_id="foreign-plan-asset",
        decision=_make_decision(a.id, "A", review=True),
        ai_metadata={},
    )

    resp = client.post(
        f"/api/routing/plans/{plan_a.id}/approve",
        json={"item_ids": [item_b.id]},
    )

    assert resp.status_code == 200
    assert resp.json()["approved"] == 0
    db.refresh(item_b)
    assert item_b.status == "pending"


def test_move_items_to_new_leaf(db):
    _clean(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    a = svc.create_node(RoutingNodeCreate(name="A"))
    b = svc.create_node(RoutingNodeCreate(name="B", destination_type="immich_trash"))
    plan_svc = RoutingPlanService(db, TEST_USER_ID)
    plan = plan_svc.create_plan()
    item = plan_svc.add_item(
        plan,
        asset_id="asset-x",
        decision=_make_decision(a.id, "A", review=True),
        ai_metadata={},
    )
    moved = plan_svc.move_items([item.id], b.id)
    assert moved == 1
    db.refresh(item)
    assert item.primary_bucket_id == b.id
    assert item.primary_bucket_path == "B"
    assert item.disposition == "trash_candidate"


def test_routing_classify_endpoint_creates_job_and_plan(client, monkeypatch):
    """The /api/routing/classify endpoint should enqueue a job & return ids."""
    captured = {}

    def fake_enqueue(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs

    monkeypatch.setattr("app.workers.executor.enqueue", fake_enqueue)

    resp = client.post("/api/routing/classify", json={"limit": 5, "force": False})
    assert resp.status_code == 200
    body = resp.json()
    assert body["job_id"]
    assert body["plan_id"]
    assert body["status"] == "queued"


def test_routing_tree_endpoint_returns_nested(client, db):
    _clean(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    parent = svc.create_node(RoutingNodeCreate(name="Personal", is_leaf=False))
    svc.create_node(RoutingNodeCreate(name="Lake House", parent_id=parent.id))
    resp = client.get("/api/routing/tree")
    assert resp.status_code == 200
    nodes = resp.json()["nodes"]
    assert any(n["path"] == "Personal" and len(n["children"]) == 1 for n in nodes)


def test_routing_node_create_endpoint(client, db):
    _clean(db)
    resp = client.post("/api/routing/nodes", json={
        "name": "Family",
        "destination_type": "virtual",
        "is_leaf": True,
    })
    assert resp.status_code == 200
    assert resp.json()["path"] == "Family"


def test_routing_node_prompt_preview(client, db):
    _clean(db)
    resp = client.post("/api/routing/nodes", json={
        "name": "Family",
        "is_leaf": True,
        "positive_criteria": ["family photos"],
    })
    node_id = resp.json()["id"]
    preview = client.get(f"/api/routing/nodes/{node_id}/prompt-preview")
    assert preview.status_code == 200
    body = preview.json()
    assert body["path"] == "Family"
    assert "family photos" in body["compiled_prompt"]


def test_examples_lifecycle(client, db):
    _clean(db)
    create = client.post("/api/routing/nodes", json={"name": "Lake"})
    node_id = create.json()["id"]
    add = client.post(f"/api/routing/nodes/{node_id}/examples", json={
        "example_type": "positive",
        "note": "kayak"
    })
    assert add.status_code == 200
    ex_id = add.json()["id"]
    listed = client.get(f"/api/routing/nodes/{node_id}/examples")
    assert listed.status_code == 200
    assert any(e["id"] == ex_id for e in listed.json())
    deleted = client.delete(f"/api/routing/examples/{ex_id}")
    assert deleted.status_code == 200


def test_add_example_rejects_other_users_asset(client, db):
    _clean(db)
    create = client.post("/api/routing/nodes", json={"name": "Lake"})
    node_id = create.json()["id"]
    db.add(Asset(
        id="other-user-asset",
        user_id="other-user",
        immich_id="other-immich-id",
        original_filename="other.jpg",
    ))
    db.commit()

    resp = client.post(f"/api/routing/nodes/{node_id}/examples", json={
        "asset_id": "other-user-asset",
        "example_type": "positive",
    })

    assert resp.status_code == 404
