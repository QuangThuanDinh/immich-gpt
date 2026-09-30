import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, LoaderCircle, X } from "lucide-react";
import {
  approveRoutingPlanItems,
  getRoutingPlanItems,
  rejectRoutingPlanItems,
  updateRoutingPlanItem,
} from "../services/api";
import type {
  RoutingNode,
  RoutingPlanGroupItem,
  RoutingPlanItem,
  RoutingPlanItemUpdate,
  RoutingPlanSummary,
} from "../types";
import Thumbnail from "./Thumbnail";
import styles from "./RoutingPlanGroup.module.css";

const ACTION_BATCH_SIZE = 10;

type ReviewAction = "approve" | "reject";
type GroupActionKey = "approve-all" | "reject-all" | "approve-page" | "reject-page";

interface Props {
  planId: string;
  groupKey: keyof RoutingPlanSummary["groups"];
  group: RoutingPlanGroupItem;
  destinations: RoutingNode[];
  allowActions: boolean;
  pageSize: number;
  expanded: boolean;
  onToggle: () => void;
  onAssetClick: (assetId: string) => void;
}

function locationText(location: Record<string, unknown> | null | undefined): string {
  if (!location) return "";
  if (typeof location.place_name === "string") return location.place_name;
  const latitude = location.latitude ?? location.lat;
  const longitude = location.longitude ?? location.lon ?? location.lng;
  if (latitude != null && longitude != null) return `${latitude}, ${longitude}`;
  return "";
}

function ReviewItem({
  planId,
  item,
  destinations,
  onAssetClick,
}: {
  planId: string;
  item: RoutingPlanItem;
  destinations: RoutingNode[];
  onAssetClick: (assetId: string) => void;
}) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(item.suggested_description ?? "");
  const [tags, setTags] = useState(item.suggested_tags.join(", "));
  const [location, setLocation] = useState(locationText(item.suggested_location));
  const [caption, setCaption] = useState(item.suggested_caption ?? "");
  const [bucketId, setBucketId] = useState(item.primary_bucket_id ?? "");
  const [busy, setBusy] = useState(false);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const editable = item.status === "pending" || item.status === "failed";

  useEffect(() => {
    setDescription(item.suggested_description ?? "");
    setTags(item.suggested_tags.join(", "));
    setLocation(locationText(item.suggested_location));
    setCaption(item.suggested_caption ?? "");
    setBucketId(item.primary_bucket_id ?? "");
  }, [item]);

  const itemQueryKey = ["routing-plan-items", planId];

  const buildUpdate = (
    overrides: Partial<RoutingPlanItemUpdate> = {}
  ): RoutingPlanItemUpdate => {
    const nextLocation = location.trim();
    return {
      suggested_description: description,
      suggested_tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      suggested_location: nextLocation
        ? { ...(item.suggested_location ?? {}), place_name: nextLocation }
        : null,
      suggested_caption: caption,
      ...overrides,
    };
  };

  const save = async (overrides?: Partial<RoutingPlanItemUpdate>) => {
    if (!editable) return;
    setSaveError(false);
    try {
      await updateRoutingPlanItem(planId, item.id, buildUpdate(overrides));
      const invalidations = [
        qc.invalidateQueries({ queryKey: itemQueryKey }),
      ];
      if (overrides && "primary_bucket_id" in overrides) {
        invalidations.push(
          qc.invalidateQueries({ queryKey: ["routing-plan-summary", planId] })
        );
      }
      await Promise.all(invalidations);
    } catch (error) {
      setSaveError(true);
      throw error;
    }
  };

  const review = async (action: ReviewAction) => {
    setBusy(true);
    setReviewAction(action);
    setReviewError(null);
    try {
      await save();
      if (action === "approve") {
        const result = await approveRoutingPlanItems(
          planId,
          { item_ids: [item.id] },
        );
        if (result.failed > 0) {
          setReviewError("Approved, but writeback to Immich failed");
        }
      } else {
        await rejectRoutingPlanItems(planId, { item_ids: [item.id] });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: itemQueryKey }),
        qc.invalidateQueries({ queryKey: ["routing-plan-summary", planId] }),
        qc.invalidateQueries({ queryKey: ["routing-plans"] }),
      ]);
    } catch {
      setReviewError("Action failed");
    } finally {
      setBusy(false);
      setReviewAction(null);
    }
  };

  const textValue = (value: string) => value || "—";

  return (
    <div className={styles.item}>
      <Thumbnail
        assetId={item.asset_id}
        size={100}
        className={styles.thumbnail}
        onClick={() => onAssetClick(item.asset_id)}
        ariaLabel="View asset metadata"
      />
      <div className={styles.fields}>
        {editable ? (
          <>
            <label>
              <span>Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => void save()} />
            </label>
            <label>
              <span>Tags</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => void save()} />
            </label>
            <label>
              <span>Location</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} onBlur={() => void save()} />
            </label>
            <label>
              <span>Caption</span>
              <input value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => void save()} />
            </label>
            <label>
              <span>Album</span>
              <select
                value={bucketId}
                onChange={(e) => {
                  const nextBucketId = e.target.value;
                  setBucketId(nextBucketId);
                  setBusy(true);
                  void save({ primary_bucket_id: nextBucketId || null })
                    .finally(() => setBusy(false));
                }}
              >
                <option value="">No destination</option>
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>{destination.path}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <div><span>Description</span><strong>{textValue(description)}</strong></div>
            <div><span>Tags</span><strong>{textValue(tags)}</strong></div>
            <div><span>Location</span><strong>{textValue(location)}</strong></div>
            <div><span>Caption</span><strong>{textValue(caption)}</strong></div>
            <div><span>Album</span><strong>{textValue(item.primary_bucket_path ?? "")}</strong></div>
          </>
        )}
      </div>
      <div className={styles.itemActions}>
        <span className={styles.status}>
          {item.status === "approved" ? "Approved - retry required" : item.status}
        </span>
        {editable && (
          <div className={styles.itemButtonRow}>
            <button
              className={styles.approve}
              disabled={busy}
              onClick={() => void review("approve")}
              aria-label={reviewAction === "approve" ? "Processing approval" : "Approve"}
              title="Approve"
            >
              {reviewAction === "approve" ? (
                <LoaderCircle className={styles.spinner} size={14} />
              ) : <Check size={14} />}
            </button>
            <button
              className={styles.reject}
              disabled={busy}
              onClick={() => void review("reject")}
              aria-label={reviewAction === "reject" ? "Processing rejection" : "Reject"}
              title="Reject"
            >
              {reviewAction === "reject" ? (
                <LoaderCircle className={styles.spinner} size={14} />
              ) : <X size={14} />}
            </button>
          </div>
        )}
        {saveError && <span className={styles.error}>Save failed</span>}
        {item.status === "failed" && item.error_message && (
          <span className={styles.error} title={item.error_message}>
            {item.error_message}
          </span>
        )}
        {reviewError && <span className={styles.error}>{reviewError}</span>}
      </div>
    </div>
  );
}

export default function RoutingPlanGroup({
  planId,
  groupKey,
  group,
  destinations,
  allowActions,
  pageSize,
  expanded,
  onToggle,
  onAssetClick,
}: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    action: GroupActionKey;
    completed: number;
    total: number;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(group.count / pageSize));
  const queryKey = [
    "routing-plan-items",
    planId,
    groupKey,
    group.bucket_id ?? null,
    group.path,
    page,
  ];

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const { data: items = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => getRoutingPlanItems(planId, {
      group_key: groupKey,
      bucket_id: group.bucket_id ?? undefined,
      path: group.bucket_id ? undefined : (group.path === "(no destination)" ? undefined : group.path),
      page,
      page_size: pageSize,
    }),
    enabled: expanded,
  });

  const actionablePageIds = useMemo(
    () => items
      .filter((item) => item.status === "pending" || item.status === "failed")
      .map((item) => item.id),
    [items]
  );

  const runAction = async (
    action: ReviewAction,
    itemIds: string[],
    actionKey: GroupActionKey
  ) => {
    if (itemIds.length === 0) return;
    setBusy(true);
    setActionError(null);
    setProgress({ action: actionKey, completed: 0, total: itemIds.length });
    try {
      let failed = 0;
      for (let offset = 0; offset < itemIds.length; offset += ACTION_BATCH_SIZE) {
        const batch = itemIds.slice(offset, offset + ACTION_BATCH_SIZE);
        if (action === "approve") {
          const result = await approveRoutingPlanItems(
            planId,
            { item_ids: batch },
          );
          failed += result.failed;
        } else {
          await rejectRoutingPlanItems(planId, { item_ids: batch });
        }
        setProgress({
          action: actionKey,
          completed: Math.min(offset + batch.length, itemIds.length),
          total: itemIds.length,
        });
      }
      if (failed > 0) {
        setActionError(
          `${failed} approved item${failed === 1 ? "" : "s"} could not be written to Immich.`
        );
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["routing-plan-items", planId] }),
        qc.invalidateQueries({ queryKey: ["routing-plan-summary", planId] }),
        qc.invalidateQueries({ queryKey: ["routing-plans"] }),
      ]);
    } catch {
      setActionError("Could not complete the action. Completed batches were saved.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const actionLabel = (action: GroupActionKey, label: string) => {
    if (progress?.action !== action) return label;
    return (
      <span className={styles.buttonContent}>
        <LoaderCircle className={styles.spinner} size={12} />
        Processing {progress.completed}/{progress.total}
      </span>
    );
  };

  return (
    <div className={styles.group}>
      <div className={styles.header}>
        <button
          className={styles.expand}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${group.path}`}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <button className={styles.title} onClick={onToggle}>
          <strong>{group.path}</strong>
          <span>{group.count} photos</span>
        </button>
        {allowActions && (
          <div className={styles.groupActions}>
            <button disabled={busy} className={styles.approve} onClick={() => void runAction("approve", group.item_ids, "approve-all")}>{actionLabel("approve-all", "Approve All")}</button>
            <button disabled={busy} className={styles.reject} onClick={() => void runAction("reject", group.item_ids, "reject-all")}>{actionLabel("reject-all", "Reject All")}</button>
            <button disabled={busy || !expanded || actionablePageIds.length === 0} className={styles.approve} onClick={() => void runAction("approve", actionablePageIds, "approve-page")}>{actionLabel("approve-page", "Approve This Page")}</button>
            <button disabled={busy || !expanded || actionablePageIds.length === 0} className={styles.reject} onClick={() => void runAction("reject", actionablePageIds, "reject-page")}>{actionLabel("reject-page", "Reject This Page")}</button>
          </div>
        )}
      </div>

      {expanded && (
        <div className={styles.panel}>
          {actionError && <div className={`${styles.message} ${styles.error}`}>{actionError}</div>}
          {isLoading && <div className={styles.message}>Loading photos...</div>}
          {isError && <div className={`${styles.message} ${styles.error}`}>Could not load photos.</div>}
          {!isLoading && !isError && items.length === 0 && <div className={styles.message}>No photos on this page.</div>}
          <div className={styles.list}>
            {items.map((item) => (
              <ReviewItem
                key={item.id}
                planId={planId}
                item={item}
                destinations={destinations}
                onAssetClick={onAssetClick}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button disabled={busy || page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={busy || page === totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
