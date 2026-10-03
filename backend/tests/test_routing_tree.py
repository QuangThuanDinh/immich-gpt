"""Routing tree CRUD and hierarchy tests."""
import pytest
from app.services.routing_tree import RoutingTreeService, RoutingTreeError
from app.schemas.bucket import (
    RoutingNodeCreate,
    RoutingNodeUpdate,
    RoutingTreeTransfer,
)
from app.models.bucket import Bucket
from app.models.routing_example import RoutingExample
from tests.conftest import TEST_USER_ID


def _seed_clean_tree(db):
    """Wipe the conftest-seeded buckets so each test starts empty."""
    db.query(Bucket).filter(Bucket.user_id == TEST_USER_ID).delete()
    db.commit()


def test_create_root_node(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    node = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=True))
    assert node.name == "Business"
    assert node.path == "Business"
    assert node.parent_id is None
    assert node.is_leaf is True


def test_create_ignores_manual_leaf_status(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    node = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=False))
    assert node.is_leaf is True


def test_create_child_leaf(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    parent = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=False))
    child = svc.create_node(
        RoutingNodeCreate(name="Job Photos", parent_id=parent.id, is_leaf=True)
    )
    assert child.path == "Business/Job Photos"
    assert child.parent_id == parent.id


def test_create_child_demotes_leaf_parent(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    parent = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=True))
    svc.create_node(RoutingNodeCreate(name="Sub", parent_id=parent.id))
    db.refresh(parent)
    assert parent.is_leaf is False


def test_path_updates_on_rename(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    parent = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=False))
    child = svc.create_node(
        RoutingNodeCreate(name="Job Photos", parent_id=parent.id, is_leaf=True)
    )
    grandchild = svc.create_node(
        RoutingNodeCreate(name="After", parent_id=child.id, is_leaf=True)
    )
    svc.rename_node(parent, "Work")
    db.refresh(parent)
    db.refresh(child)
    db.refresh(grandchild)
    assert parent.path == "Work"
    assert child.path == "Work/Job Photos"
    assert grandchild.path == "Work/Job Photos/After"


def test_duplicate_sibling_name_rejected(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    svc.create_node(RoutingNodeCreate(name="Business"))
    with pytest.raises(RoutingTreeError):
        svc.create_node(RoutingNodeCreate(name="Business"))


def test_disable_node_excludes_descendants_from_enabled_leaves(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    biz = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=False))
    job = svc.create_node(
        RoutingNodeCreate(name="Job Photos", parent_id=biz.id, is_leaf=True)
    )
    leaves_before = {l.id for l in svc.get_enabled_leaves()}
    assert job.id in leaves_before

    svc.update_node(biz.id, RoutingNodeUpdate(enabled=False))
    leaves_after = {l.id for l in svc.get_enabled_leaves()}
    assert job.id not in leaves_after


def test_move_node_updates_paths(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    biz = svc.create_node(RoutingNodeCreate(name="Business", is_leaf=False))
    personal = svc.create_node(RoutingNodeCreate(name="Personal", is_leaf=False))
    leaf = svc.create_node(
        RoutingNodeCreate(name="Lake", parent_id=biz.id, is_leaf=True)
    )
    svc.move_node(leaf.id, personal.id)
    db.refresh(leaf)
    db.refresh(biz)
    db.refresh(personal)
    assert leaf.path == "Personal/Lake"
    assert biz.is_leaf is True
    assert personal.is_leaf is False


def test_delete_last_child_promotes_parent_to_leaf(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    parent = svc.create_node(RoutingNodeCreate(name="Business"))
    child = svc.create_node(RoutingNodeCreate(name="Job Photos", parent_id=parent.id))
    svc.delete_node(child.id)
    db.refresh(parent)
    assert parent.is_leaf is True


def test_cannot_move_node_into_descendant(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    a = svc.create_node(RoutingNodeCreate(name="A", is_leaf=False))
    b = svc.create_node(RoutingNodeCreate(name="B", parent_id=a.id, is_leaf=False))
    with pytest.raises(RoutingTreeError):
        svc.move_node(a.id, b.id)


def test_delete_with_children_requires_cascade(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    a = svc.create_node(RoutingNodeCreate(name="A", is_leaf=False))
    svc.create_node(RoutingNodeCreate(name="B", parent_id=a.id))
    with pytest.raises(RoutingTreeError):
        svc.delete_node(a.id)
    svc.delete_node(a.id, cascade=True)
    assert svc._get_or_none(a.id) is None


def test_invalid_destination_type(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    with pytest.raises(RoutingTreeError):
        svc.create_node(RoutingNodeCreate(name="X", destination_type="bogus"))


def test_invalid_privacy_rule(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    with pytest.raises(RoutingTreeError):
        svc.create_node(
            RoutingNodeCreate(name="X", privacy_rules={"faces_visible": "weird"})
        )


def test_tree_settings_round_trip_replaces_tree_and_excludes_examples(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    root = svc.create_node(RoutingNodeCreate(
        name="Documents",
        description="Readable information",
        priority=5,
        enabled=False,
        positive_criteria=["paper", "email"],
        negative_criteria=["recipe"],
        custom_prompt_enabled=True,
        custom_prompt="Use document tags.",
    ))
    child = svc.create_node(RoutingNodeCreate(
        name="Tax",
        parent_id=root.id,
        destination_type="immich_album",
        immich_album_name="Taxes",
        auto_apply_enabled=True,
        auto_apply_threshold=0.97,
        privacy_rules={"documents_visible": "allow"},
    ))
    db.add(RoutingExample(
        id="tree-export-example",
        user_id=TEST_USER_ID,
        bucket_id=child.id,
        example_type="positive",
        source="manual",
        note="Do not export me",
    ))
    db.commit()

    exported = svc.export_settings()
    assert exported.version == 1
    assert exported.nodes[0].name == "Documents"
    assert exported.nodes[0].children[0].name == "Tax"
    assert "id" not in exported.model_dump()["nodes"][0]
    assert "parent_id" not in exported.model_dump()["nodes"][0]
    assert "examples" not in exported.model_dump()["nodes"][0]

    svc.create_node(RoutingNodeCreate(name="Temporary"))
    imported = svc.replace_settings(exported)

    assert [node["name"] for node in imported] == ["Documents"]
    restored_root = imported[0]
    assert restored_root["description"] == "Readable information"
    assert restored_root["priority"] == 5
    assert restored_root["enabled"] is False
    assert restored_root["positive_criteria"] == ["paper", "email"]
    assert restored_root["negative_criteria"] == ["recipe"]
    assert restored_root["custom_prompt"] == "Use document tags."
    restored_child = restored_root["children"][0]
    assert restored_child["path"] == "Documents/Tax"
    assert restored_child["destination_type"] == "immich_album"
    assert restored_child["immich_album_name"] == "Taxes"
    assert restored_child["auto_apply_threshold"] == 0.97
    assert restored_child["privacy_rules"] == {"documents_visible": "allow"}
    assert db.query(RoutingExample).filter(
        RoutingExample.user_id == TEST_USER_ID,
    ).count() == 0


def test_invalid_tree_import_preserves_existing_tree(db):
    _seed_clean_tree(db)
    svc = RoutingTreeService(db, TEST_USER_ID)
    svc.create_node(RoutingNodeCreate(name="Existing"))
    invalid = RoutingTreeTransfer.model_validate({
        "version": 1,
        "nodes": [
            {"name": "Duplicate"},
            {"name": "Duplicate"},
        ],
    })

    with pytest.raises(RoutingTreeError, match="Duplicate routing path"):
        svc.replace_settings(invalid)

    assert [node.name for node in svc.list_nodes()] == ["Existing"]
