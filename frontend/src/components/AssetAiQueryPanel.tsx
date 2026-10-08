import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, LoaderCircle, Sparkles, X } from "lucide-react";
import {
  approveRoutingPlanItems,
  cancelJob,
  deleteRoutingPlan,
  getJob,
  getRoutingPlanItems,
  listRoutingNodes,
  refreshAssetMetadata,
  rejectRoutingPlanItems,
  startRoutingClassify,
  updateRoutingPlanItem,
} from "../services/api";
import type { Asset, RoutingPlanItem, RoutingPlanItemUpdate } from "../types";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CLOSE_POLL_INTERVAL_MS = 250;
const CLOSE_POLL_ATTEMPTS = 120;

interface Props {
  assetId: string;
  assetName: string;
  assetPreview: React.ReactNode;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #334155",
  borderRadius: 6,
  background: "#0f172a",
  color: "#e2e8f0",
  padding: "8px 10px",
  fontSize: 13,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function AssetAiQueryPanel({ assetId, assetName, assetPreview, onClose }: Props) {
  const queryClient = useQueryClient();
  const [run, setRun] = React.useState<{ jobId: string; planId: string } | null>(null);
  const [item, setItem] = React.useState<RoutingPlanItem | null>(null);
  const [destinationId, setDestinationId] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [caption, setCaption] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [closeRequested, setCloseRequested] = React.useState(false);

  const startMutation = useMutation({
    mutationFn: () => startRoutingClassify({
      asset_ids: [assetId],
      force: true,
      review_only: true,
    }),
    onSuccess: (result) => setRun({ jobId: result.job_id, planId: result.plan_id }),
  });

  React.useEffect(() => {
    startMutation.mutate();
    // The dialog is remounted for every request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: job } = useQuery({
    queryKey: ["job", run?.jobId],
    queryFn: () => getJob(run!.jobId),
    enabled: !!run,
    refetchInterval: (query) => {
      const current = query.state.data;
      return current && TERMINAL_STATUSES.has(current.status) ? false : 1000;
    },
  });

  const classificationComplete = job?.status === "completed";
  const { data: planItems, isError: itemsError } = useQuery({
    queryKey: ["routing-plan-items", run?.planId, "ai-query", assetId],
    queryFn: () => getRoutingPlanItems(run!.planId, { page: 1, page_size: 2 }),
    enabled: !!run && classificationComplete,
  });
  const { data: routingNodes = [] } = useQuery({
    queryKey: ["routing-nodes"],
    queryFn: listRoutingNodes,
  });
  const destinations = routingNodes.filter((node) => node.is_leaf && node.enabled);

  React.useEffect(() => {
    if (!planItems) return;
    const result = planItems.find((candidate) => candidate.asset_id === assetId);
    if (!result) return;
    setItem(result);
    setDestinationId(result.primary_bucket_id ?? "");
    setDescription(result.suggested_description ?? "");
    setCaption(result.suggested_caption ?? "");
    setTags(result.suggested_tags.join(", "));
    setLocation(String(result.suggested_location?.place_name ?? ""));
  }, [assetId, planItems]);

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!run) throw new Error("The AI query has not started.");
      let currentJob = await getJob(run.jobId);
      if (!TERMINAL_STATUSES.has(currentJob.status)) {
        try {
          await cancelJob(run.jobId);
        } catch (cancelError) {
          currentJob = await getJob(run.jobId);
          if (!TERMINAL_STATUSES.has(currentJob.status)) throw cancelError;
        }
      }
      for (
        let attempt = 0;
        attempt < CLOSE_POLL_ATTEMPTS && !TERMINAL_STATUSES.has(currentJob.status);
        attempt += 1
      ) {
        await delay(CLOSE_POLL_INTERVAL_MS);
        currentJob = await getJob(run.jobId);
      }
      if (!TERMINAL_STATUSES.has(currentJob.status)) {
        throw new Error("The AI query is still stopping. Try again in a moment.");
      }
      await deleteRoutingPlan(run.planId);
    },
    onSuccess: onClose,
  });

  const requestClose = React.useCallback(() => {
    setCloseRequested(true);
    if (run && !closeMutation.isPending) {
      closeMutation.mutate();
    } else if (startMutation.isError) {
      onClose();
    }
  }, [closeMutation, onClose, run, startMutation.isError]);

  React.useEffect(() => {
    if (closeRequested && run && closeMutation.isIdle) {
      closeMutation.mutate();
    } else if (closeRequested && !run && startMutation.isError) {
      onClose();
    }
  }, [
    closeMutation,
    closeRequested,
    onClose,
    run,
    startMutation.isError,
  ]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [requestClose]);

  const actionMutation = useMutation({
    mutationFn: async (action: "approve" | "reject") => {
      if (!run || !item) throw new Error("The AI result is not ready.");
      const currentLocation = item.suggested_location ?? {};
      const update: RoutingPlanItemUpdate = {
        primary_bucket_id: destinationId || null,
        suggested_description: description.trim() || null,
        suggested_caption: caption.trim() || null,
        suggested_tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        suggested_location: location.trim()
          ? { ...currentLocation, place_name: location.trim() }
          : null,
      };
      await updateRoutingPlanItem(run.planId, item.id, update);

      if (action === "reject") {
        await rejectRoutingPlanItems(run.planId, { item_ids: [item.id] });
        await deleteRoutingPlan(run.planId);
        return;
      }

      const result = await approveRoutingPlanItems(run.planId, { item_ids: [item.id] });
      if (result.failed > 0) {
        throw new Error("Immich rejected one or more metadata updates. Review the routing plan for details.");
      }
      try {
        const refreshed = await refreshAssetMetadata(assetId);
        queryClient.setQueryData<Asset>(["asset", assetId], refreshed);
      } catch {
        void queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      }
      await deleteRoutingPlan(run.planId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["routing-plans"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      onClose();
    },
  });

  const jobFailed = job && (job.status === "failed" || job.status === "cancelled");
  const noResult = classificationComplete && planItems && !item;
  const displayedError = startMutation.isError
    ? errorMessage(startMutation.error, "Could not start the AI query.")
    : closeMutation.isError
      ? errorMessage(closeMutation.error, "Could not close the AI query.")
    : jobFailed
      ? job.message || `AI query ${job.status}.`
      : itemsError
        ? "Could not load the AI result."
        : noResult
          ? "The AI query completed without a result for this asset."
          : actionMutation.isError
            ? errorMessage(actionMutation.error, "Could not update this asset.")
            : null;

  if (!item) {
    return (
      <div
        role="status"
        aria-label="AI Query loading"
        style={{
          position: "absolute",
          inset: "57px 0 57px",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          background: "rgba(15, 23, 42, 0.9)",
          color: "#94a3b8",
          textAlign: "center",
        }}
      >
        {!displayedError && (
          <>
            <style>
              {"@keyframes ai-query-spin { to { transform: rotate(360deg); } }"}
            </style>
            <LoaderCircle
              data-testid="ai-query-spinner"
              size={22}
              style={{ animation: "ai-query-spin 0.8s linear infinite" }}
            />
            <span>{job?.current_step || "Loading AI query..."}</span>
          </>
        )}
        {displayedError && (
          <div role="alert" style={{ background: "#7f1d1d30", border: "1px solid #ef444450", borderRadius: 6, color: "#fca5a5", padding: 12, fontSize: 13 }}>
            {displayedError}
          </div>
        )}
        <button
          onClick={requestClose}
          disabled={closeMutation.isPending}
          style={{ border: "1px solid #475569", background: "#0f172a", color: "#cbd5e1", borderRadius: 6, padding: "7px 13px", cursor: "pointer" }}
        >
          {closeMutation.isPending ? "Closing..." : closeMutation.isError ? "Retry close" : "Cancel"}
        </button>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="AI Query result"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(480px, 100vw)",
        zIndex: 202,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#111827",
        borderLeft: "1px solid #334155",
        boxShadow: "-16px 0 40px rgba(0,0,0,0.28)",
      }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 20px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
          <button
            onClick={requestClose}
            aria-label="Back to asset metadata"
            disabled={closeMutation.isPending}
            style={{ background: "none", border: 0, color: "#94a3b8", cursor: "pointer", padding: 3 }}
          >
            <ChevronLeft size={19} />
          </button>
          <Sparkles size={18} color="#c084fc" />
          <strong style={{ color: "#f1f5f9", fontSize: 15, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            AI Query for {assetName}
          </strong>
        </div>

        <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
          <div style={{ margin: "-20px -20px 18px" }}>
            {assetPreview}
          </div>
          {displayedError && (
            <div role="alert" style={{ background: "#7f1d1d30", border: "1px solid #ef444450", borderRadius: 6, color: "#fca5a5", padding: 12, fontSize: 13 }}>
              {displayedError}
            </div>
          )}

          {!jobFailed && (
            <>
              <Field label="Destination route">
                <select
                  aria-label="Destination route"
                  value={destinationId}
                  onChange={(event) => setDestinationId(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select a destination</option>
                  {destinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.path}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description">
                <textarea
                  aria-label="Description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </Field>
              <Field label="Caption">
                <textarea
                  aria-label="Caption"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </Field>
              <Field label="Tags">
                <input
                  aria-label="Tags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="tag one, tag two"
                  style={inputStyle}
                />
              </Field>
              <Field label="Location">
                <input
                  aria-label="Location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Place name"
                  style={inputStyle}
                />
              </Field>
              <div style={{ color: "#64748b", fontSize: 11, marginTop: -5, marginBottom: 16 }}>
                Route writeback settings determine which fields are sent to Immich.
              </div>
            </>
          )}
        </div>
        {!jobFailed && (
          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid #1e293b",
            background: "#111827",
            flexShrink: 0,
          }}>
            <button
              onClick={() => actionMutation.mutate("approve")}
              disabled={actionMutation.isPending || closeMutation.isPending || !destinationId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid #a855f740",
                background: "#a855f718",
                color: "#c084fc",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 12,
                cursor: "pointer",
                opacity: actionMutation.isPending || !destinationId ? 0.6 : 1,
              }}
            >
              <Check size={14} />
              {actionMutation.isPending ? "Saving..." : "Approve"}
            </button>
            <button
              onClick={() => actionMutation.mutate("reject")}
              disabled={actionMutation.isPending || closeMutation.isPending}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid #475569",
                background: "#1e293b80",
                color: "#cbd5e1",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 12,
                cursor: "pointer",
                opacity: actionMutation.isPending ? 0.6 : 1,
              }}
            >
              <X size={14} />
              Reject
            </button>
          </div>
        )}
    </div>
  );
}
