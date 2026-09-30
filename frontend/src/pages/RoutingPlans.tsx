import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listRoutingPlans,
  getRoutingPlanSummary,
  listRoutingNodes,
  applyRoutingPlan,
  startRoutingClassify,
} from "../services/api";
import type { RoutingPlanSummary, RoutingPlanGroupItem } from "../types";
import { usePageVisible } from "../hooks/usePageVisible";
import RunRoutingButton from "../components/RunRoutingButton";
import RoutingPlanGroup from "../components/RoutingPlanGroup";
import { CheckCircle2, AlertTriangle, Trash2, XCircle, Clock, type LucideIcon } from "lucide-react";

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

export default function RoutingPlans() {
  const qc = useQueryClient();
  const pageVisible = usePageVisible();
  const { data: plans = [] } = useQuery({ queryKey: ["routing-plans"], queryFn: () => listRoutingPlans() });
  const { data: routingNodes = [] } = useQuery({
    queryKey: ["routing-nodes"],
    queryFn: listRoutingNodes,
  });
  const destinations = routingNodes.filter((node) => node.is_leaf && node.enabled);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery<RoutingPlanSummary>({
    queryKey: ["routing-plan-summary", selectedPlanId],
    queryFn: () => getRoutingPlanSummary(selectedPlanId!),
    enabled: !!selectedPlanId,
    refetchInterval: pageVisible ? 5000 : false,
  });

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

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1952 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>Routing plans</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>
            Review and apply batches of AI routing decisions.
          </p>
        </div>
        <RunRoutingButton
          label="Run new plan"
          pending={classifyMut.isPending}
          onRun={(force) => classifyMut.mutate(force)}
          primary
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24 }}>
        <div style={{
          background: "#0f172a", border: "1px solid #1e293b",
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
            Recent plans
          </div>
          {plans.length === 0 && (
            <div style={{ color: "#475569", fontSize: 13 }}>No plans yet. Run a routing job first.</div>
          )}
          {plans.map((p) => (
            <div
              key={p.id}
              onClick={() => {
                applyMut.reset();
                setSelectedPlanId(p.id);
                setExpandedGroupId(null);
              }}
              style={{
                padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                background: selectedPlanId === p.id ? "rgba(59,130,246,0.12)" : "#1e293b",
                border: "1px solid #1e293b",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Clock size={12} color="#64748b" />
                <span style={{ fontSize: 12, color: "#e2e8f0" }}>
                  {new Date(p.created_at).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                {p.status} · {p.item_count} item{p.item_count === 1 ? "" : "s"}
              </div>
            </div>
          ))}
        </div>

        <div>
          {!selectedPlanId && (
            <div style={{
              padding: 32, textAlign: "center",
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
              color: "#64748b",
            }}>
              Select a plan from the list, or run a new one.
            </div>
          )}
          {selectedPlanId && summaryLoading && (
            <div style={{
              padding: 32, textAlign: "center",
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
              color: "#64748b",
            }}>
              Loading plan summary...
            </div>
          )}
          {selectedPlanId && summaryError && (
            <div style={{
              padding: 32, textAlign: "center",
              background: "#0f172a", border: "1px solid #7f1d1d", borderRadius: 12,
              color: "#fca5a5",
            }}>
              Could not load this plan summary. Try selecting it again.
            </div>
          )}
          {selectedPlanId && summary && (
            <div>
              <div style={{
                background: "#0f172a", border: "1px solid #1e293b",
                borderRadius: 12, padding: 16, marginBottom: 16,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Plan total</div>
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
                            }
                            pageSize={summary.page_size ?? 20}
                            expanded={expandedGroupId === groupId}
                            onToggle={() => setExpandedGroupId((current) => (
                              current === groupId ? null : groupId
                            ))}
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
    </div>
  );
}
