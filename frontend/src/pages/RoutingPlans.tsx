import React, { useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  listRoutingPlansPage,
  getRoutingPlan,
  getRoutingPlanSummary,
  listRoutingNodes,
  applyRoutingPlan,
  startRoutingClassify,
  archiveRoutingPlan,
} from "../services/api";
import type {
  RoutingPlan,
  RoutingPlanSummary,
  RoutingPlanGroupItem,
} from "../types";
import { usePageVisible } from "../hooks/usePageVisible";
import RunRoutingButton from "../components/RunRoutingButton";
import RoutingPlanGroup from "../components/RoutingPlanGroup";
import AssetDetailPanel from "../components/AssetDetailPanel";
import MobileSidebarToggle from "../components/MobileSidebarToggle";
import masterDetail from "../styles/MasterDetail.module.css";
import styles from "./RoutingPlans.module.css";
import {
  Archive, ArchiveRestore, CheckCircle2, AlertTriangle, Trash2,
  XCircle, Clock, ChevronLeft, LoaderCircle, type LucideIcon,
} from "lucide-react";
import { useTimezone } from "../hooks/useTimezone";

const PLAN_PAGE_SIZE = 10;

const GROUP_DEFS: {
  key: keyof RoutingPlanSummary["groups"];
  label: string;
  color: string;
  icon: LucideIcon;
}[] = [
  { key: "auto_applied", label: "Applied", color: "#22c55e", icon: CheckCircle2 },
  { key: "ready_to_approve", label: "Ready to approve", color: "#38bdf8", icon: CheckCircle2 },
  { key: "needs_review", label: "Needs review", color: "#f59e0b", icon: AlertTriangle },
  { key: "trash_candidates", label: "Trash candidates", color: "#ef4444", icon: Trash2 },
  { key: "rejected", label: "Rejected", color: "#64748b", icon: XCircle },
  { key: "failed", label: "Failed", color: "#ef4444", icon: XCircle },
];

function PlanStatusIcon({ status }: { status: string }) {
  if (status === "applied") {
    return (
      <span role="img" aria-label="Finished plan" title="Finished">
        <CheckCircle2 size={12} color="#22c55e" />
      </span>
    );
  }
  if (status === "partially_applied") {
    return (
      <span role="img" aria-label="Partially applied plan" title="Partially applied">
        <AlertTriangle size={12} color="#f59e0b" />
      </span>
    );
  }
  return (
    <span role="img" aria-label={`${status} plan`} title={status}>
      <Clock size={12} color="#64748b" />
    </span>
  );
}

export default function RoutingPlans() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { formatDateTime } = useTimezone();
  const pageVisible = usePageVisible();
  const [archiveMode, setArchiveMode] = useState(false);
  const [focusedArchiveTab, setFocusedArchiveTab] = useState(false);
  const recentTabRef = useRef<HTMLButtonElement | null>(null);
  const archivedTabRef = useRef<HTMLButtonElement | null>(null);
  const [focusedPlanId, setFocusedPlanId] = useState<string | null>(null);
  const planRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const archiveButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const {
    data: planPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: plansFetching,
    isError: plansError,
  } = useInfiniteQuery({
    queryKey: ["routing-plans", { archived: archiveMode }],
    queryFn: ({ pageParam }) => listRoutingPlansPage({
      archived: archiveMode,
      limit: PLAN_PAGE_SIZE,
      offset: pageParam,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (
      lastPage.has_more
        ? lastPage.offset + lastPage.items.length
        : undefined
    ),
  });
  const plans = planPages?.pages.flatMap((page) => page.items) ?? [];
  const activeFocusedPlanId = plans.some((plan) => plan.id === focusedPlanId)
    ? focusedPlanId
    : plans[0]?.id ?? null;
  const { data: routingNodes = [] } = useQuery({
    queryKey: ["routing-nodes"],
    queryFn: listRoutingNodes,
  });
  const destinations = routingNodes.filter((node) => node.is_leaf && node.enabled);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    searchParams.get("plan"),
  );
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const closePlan = () => {
    setSelectedPlanId(null);
    setSearchParams({}, { replace: true });
    setExpandedGroupId(null);
    setSelectedAssetId(null);
  };

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<RoutingPlanSummary>({
    queryKey: ["routing-plan-summary", selectedPlanId],
    queryFn: () => getRoutingPlanSummary(selectedPlanId!),
    enabled: !!selectedPlanId,
    refetchInterval: pageVisible ? 5000 : false,
  });
  const {
    data: selectedPlan,
    isLoading: planLoading,
    isError: planError,
  } = useQuery<RoutingPlan>({
    queryKey: ["routing-plan", selectedPlanId],
    queryFn: () => getRoutingPlan(selectedPlanId!),
    enabled: !!selectedPlanId,
  });
  const detailLoading = planLoading || summaryLoading;
  const detailError = planError || summaryError;

  const classifyMut = useMutation({
    mutationFn: (force: boolean) => startRoutingClassify({ force }),
    onSuccess: (r) => {
      setSelectedPlanId(r.plan_id);
      qc.invalidateQueries({ queryKey: ["routing-plans"] });
    },
  });

  const applyMut = useMutation({
    mutationFn: () => applyRoutingPlan(selectedPlanId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routing-plan-summary", selectedPlanId] });
      qc.invalidateQueries({ queryKey: ["routing-plans"] });
    },
  });

  const archiveMut = useMutation({
    mutationFn: ({ planId, archived }: { planId: string; archived: boolean }) =>
      archiveRoutingPlan(planId, archived),
    onSuccess: (plan) => {
      if (selectedPlanId === plan.id) closePlan();
      qc.invalidateQueries({ queryKey: ["routing-plans"] });
    },
  });

  const changeArchiveMode = (archived: boolean) => {
    closePlan();
    setFocusedArchiveTab(archived);
    setArchiveMode(archived);
  };

  const moveArchiveTabFocus = (archived: boolean) => {
    setFocusedArchiveTab(archived);
    (archived ? archivedTabRef.current : recentTabRef.current)?.focus();
  };

  const selectPlan = (planId: string) => {
    applyMut.reset();
    setSelectedPlanId(planId);
    setSearchParams({ plan: planId }, { replace: true });
    setExpandedGroupId(null);
    setSelectedAssetId(null);
  };

  const focusPlan = (planId: string) => {
    setFocusedPlanId(planId);
    planRefs.current[planId]?.focus();
  };

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
      <div className={masterDetail.pageHeader} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className={masterDetail.titleRow}>
            <MobileSidebarToggle />
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>Routing plans</h1>
          </div>
          <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>
            Review and apply batches of AI routing decisions.
          </p>
        </div>
        <div className={masterDetail.pageActions} style={{ display: "flex" }}>
          <RunRoutingButton
            label="Run Routing"
            pending={classifyMut.isPending}
            onRun={(force) => classifyMut.mutate(force)}
            primary
          />
        </div>
      </div>

      <div className={masterDetail.layout}>
        <div className={[masterDetail.master, selectedPlanId ? masterDetail.masterHidden : ""].join(" ")} style={{
          background: "#0f172a", border: "1px solid #1e293b",
          borderRadius: 12, padding: 16,
        }}>
          <div
            role="tablist"
            aria-label="Plan history"
            style={{
              display: "flex",
              gap: 18,
              marginBottom: 12,
              borderBottom: "1px solid #334155",
            }}
          >
            <button
              ref={recentTabRef}
              type="button"
              role="tab"
              tabIndex={!focusedArchiveTab ? 0 : -1}
              onClick={() => changeArchiveMode(false)}
              onFocus={() => setFocusedArchiveTab(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  moveArchiveTabFocus(true);
                }
              }}
              aria-selected={!archiveMode}
              style={{
                padding: "7px 2px 8px",
                border: "none",
                borderBottom: !archiveMode ? "2px solid #3b82f6" : "2px solid transparent",
                background: "transparent",
                color: !archiveMode ? "#e2e8f0" : "#64748b",
                fontSize: 12,
                fontWeight: !archiveMode ? 600 : 500,
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              Recent
            </button>
            <button
              ref={archivedTabRef}
              type="button"
              role="tab"
              tabIndex={focusedArchiveTab ? 0 : -1}
              onClick={() => changeArchiveMode(true)}
              onFocus={() => setFocusedArchiveTab(true)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  moveArchiveTabFocus(false);
                }
              }}
              aria-selected={archiveMode}
              style={{
                padding: "7px 2px 8px",
                border: "none",
                borderBottom: archiveMode ? "2px solid #3b82f6" : "2px solid transparent",
                background: "transparent",
                color: archiveMode ? "#e2e8f0" : "#64748b",
                fontSize: 12,
                fontWeight: archiveMode ? 600 : 500,
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              Archived
            </button>
          </div>
          {plansFetching && !isFetchingNextPage && (
            <div
              role="status"
              aria-label={archiveMode ? "Loading archived plans" : "Loading recent plans"}
              className={styles.loadingState}
            >
              <LoaderCircle size={18} className={styles.spinner} />
              <span>{archiveMode ? "Loading archived plans..." : "Loading recent plans..."}</span>
            </div>
          )}
          {plansError && (
            <div role="alert" className={styles.errorState}>
              Could not load {archiveMode ? "archived" : "recent"} plans.
            </div>
          )}
          {!plansFetching && !plansError && plans.length === 0 && (
            <div style={{ color: "#475569", fontSize: 13 }}>
              {archiveMode ? "No archived plans." : "No plans yet. Run a routing job first."}
            </div>
          )}
          <div role="group" aria-label={archiveMode ? "Archived plans" : "Recent plans"}>
          {plans.map((p, index) => (
            <div
              key={p.id}
              ref={(element) => { planRefs.current[p.id] = element; }}
              role="button"
              tabIndex={activeFocusedPlanId === p.id ? 0 : -1}
              aria-label={`Open ${p.status} plan from ${formatDateTime(p.created_at)}`}
              onFocus={() => setFocusedPlanId(p.id)}
              onClick={() => {
                setFocusedPlanId(p.id);
                selectPlan(p.id);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectPlan(p.id);
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusPlan(plans[(index + 1) % plans.length].id);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusPlan(plans[(index - 1 + plans.length) % plans.length].id);
                  return;
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  focusPlan(plans[0].id);
                  return;
                }
                if (event.key === "End") {
                  event.preventDefault();
                  focusPlan(plans[plans.length - 1].id);
                  return;
                }
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  archiveButtonRefs.current[p.id]?.focus();
                }
              }}
              className={styles.planCard}
              style={{
                position: "relative",
                padding: "10px 42px 10px 12px", borderRadius: 8, marginBottom: 6,
                background: selectedPlanId === p.id ? "rgba(59,130,246,0.12)" : "#1e293b",
                border: "1px solid #1e293b",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <PlanStatusIcon status={p.status} />
                <span style={{ fontSize: 12, color: "#e2e8f0" }}>
                  {formatDateTime(p.created_at)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                {p.status} · {p.item_count} item{p.item_count === 1 ? "" : "s"}
              </div>
              {p.recurring && (
                <div className={styles.planBadges}>
                  <span className={styles.planBadge}>Recurring</span>
                  {p.auto_approve && (
                    <span className={styles.planBadge}>Auto-approved</span>
                  )}
                </div>
              )}
              <button
                ref={(element) => { archiveButtonRefs.current[p.id] = element; }}
                type="button"
                aria-label={archiveMode ? "Unarchive" : "Archive"}
                title={archiveMode ? "Unarchive" : "Archive"}
                tabIndex={-1}
                disabled={archiveMut.isPending}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    focusPlan(p.id);
                    return;
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    if (index < plans.length - 1) focusPlan(plans[index + 1].id);
                  }
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  archiveMut.mutate({ planId: p.id, archived: !archiveMode });
                }}
                className={styles.archiveButton}
              >
                {archiveMode ? <ArchiveRestore size={12} /> : <Archive size={12} />}
              </button>
            </div>
          ))}
          </div>
          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{
                width: "100%", marginTop: 8, padding: "8px 12px",
                borderRadius: 7, border: "1px solid #334155",
                background: "transparent", color: "#94a3b8",
                fontSize: 12, cursor: isFetchingNextPage ? "wait" : "pointer",
              }}
            >
              {isFetchingNextPage ? "Loading..." : "Load more"}
            </button>
          )}
        </div>

        <div className={[masterDetail.detail, selectedPlanId ? "" : masterDetail.detailHidden].join(" ")}>
          {!selectedPlanId && (
            <div style={{
              padding: 32, textAlign: "center",
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
              color: "#64748b",
            }}>
              Select a plan from the list, or run a new one.
            </div>
          )}
          {selectedPlanId && detailLoading && (
            <div
              role="status"
              aria-label="Loading plan details"
              style={{
              padding: 32, textAlign: "center", display: "flex", alignItems: "center", gap: 10,
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
              color: "#64748b",
              }}
            >
              <button type="button" className={masterDetail.headerBackButton} onClick={closePlan} aria-label="Back to plans">
                <ChevronLeft size={20} />
              </button>
              <LoaderCircle size={18} className={styles.spinner} />
              <span>Loading plan details...</span>
            </div>
          )}
          {selectedPlanId && detailError && (
            <div style={{
              padding: 32, textAlign: "center", display: "flex", alignItems: "center", gap: 10,
              background: "#0f172a", border: "1px solid #7f1d1d", borderRadius: 12,
              color: "#fca5a5",
            }}>
              <button type="button" className={masterDetail.headerBackButton} onClick={closePlan} aria-label="Back to plans">
                <ChevronLeft size={20} />
              </button>
              <span>Could not load this plan. Try selecting it again.</span>
            </div>
          )}
          {selectedPlanId && selectedPlan && summary && (
            <div>
              <div style={{
                background: "#0f172a", border: "1px solid #1e293b",
                borderRadius: 12, padding: 16, marginBottom: 16,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <button type="button" className={masterDetail.headerBackButton} onClick={closePlan} aria-label="Back to plans">
                    <ChevronLeft size={20} />
                  </button>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {selectedPlan.status} plan
                    </div>
                    <div style={{ fontSize: 20, color: "#f1f5f9", fontWeight: 700 }}>
                      {summary.total} item{summary.total === 1 ? "" : "s"}
                    </div>
                  <div style={{ display: "grid", gap: 2, marginTop: 8 }}>
                    {(summary.writeback?.write_description ?? 0) > 0 && (
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        Write descriptions: {summary.writeback?.write_description ?? 0} items
                      </div>
                    )}
                    {(summary.writeback?.write_tags ?? 0) > 0 && (
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        Write tags: {summary.writeback?.write_tags ?? 0} items
                      </div>
                    )}
                    {(summary.writeback?.move_to_album ?? 0) > 0 && (
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        Move to albums: {summary.writeback?.move_to_album ?? 0} items
                      </div>
                    )}
                    {(summary.writeback?.move_to_trash ?? 0) > 0 && (
                      <div style={{ fontSize: 11, color: "#fca5a5" }}>
                        Move to trash: {summary.writeback?.move_to_trash ?? 0} items
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
                    Approve actions write changes to Immich immediately. Reject actions leave Immich unchanged.
                  </div>
                  {applyMut.data && (
                    <div style={{
                      fontSize: 11,
                      color: applyMut.data.failed > 0 ? "#fca5a5" : "#86efac",
                      marginTop: 4,
                    }}>
                      Applied {applyMut.data.applied}; failed {applyMut.data.failed}.
                    </div>
                  )}
                  {applyMut.isError && (
                    <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>
                      Could not apply approved items.
                    </div>
                  )}
                  </div>
                </div>
                <button
                  onClick={() => applyMut.mutate()}
                  disabled={applyMut.isPending}
                  style={{
                    padding: "8px 16px", borderRadius: 8, border: "none",
                    background: "#22c55e", color: "white", fontSize: 13, fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {applyMut.isPending ? "Applying..." : "Retry previously approved items"}
                </button>
              </div>

              {GROUP_DEFS.map(({ key, label, color, icon: Icon }) => {
                const items = (summary.groups[key] ?? []) as RoutingPlanGroupItem[];
                if (items.length === 0) return null;
                return (
                  <div key={key} style={{
                    background: "#0f172a", border: "1px solid #1e293b",
                    borderRadius: 12, padding: 16, marginBottom: 12,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <Icon size={16} color={color} />
                      <h3 style={{ fontSize: 14, fontWeight: 700, color, margin: 0 }}>{label}</h3>
                      <span style={{ color: "#64748b", fontSize: 12, marginLeft: 4 }}>
                        ({items.reduce((s, g) => s + g.count, 0)})
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((g) => {
                        const groupId = `${key}:${g.bucket_id ?? g.path}`;
                        return (
                          <RoutingPlanGroup
                            key={groupId}
                            planId={selectedPlanId}
                            groupKey={key}
                            group={g}
                            destinations={destinations}
                            allowActions={
                              key === "ready_to_approve"
                              || key === "needs_review"
                              || key === "trash_candidates"
                              || key === "failed"
                            }
                            pageSize={summary.page_size ?? 20}
                            expanded={expandedGroupId === groupId}
                            onToggle={() => setExpandedGroupId((current) => (
                              current === groupId ? null : groupId
                            ))}
                            onAssetClick={setSelectedAssetId}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {selectedAssetId && (
        <AssetDetailPanel
          assetId={selectedAssetId}
          onClose={() => setSelectedAssetId(null)}
        />
      )}
    </div>
  );
}
