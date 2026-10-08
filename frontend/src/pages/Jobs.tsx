import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getJobs, cancelJob, pauseJob, resumeJob, deleteJob,
  startSyncJob, startRoutingClassify,
} from "../services/api";
import { usePageVisible } from "../hooks/usePageVisible";
import JobProgressBar from "../components/JobProgressBar";
import JobDetail from "../components/JobDetail";
import MobileSidebarToggle from "../components/MobileSidebarToggle";
import RunRoutingButton from "../components/RunRoutingButton";
import RunSyncButton from "../components/RunSyncButton";
import type { SyncMode } from "../types";
import { XCircle, ChevronDown, ChevronUp, Pause, RotateCcw, Trash2 } from "lucide-react";
import styles from "./Jobs.module.css";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const ACTIVE   = new Set(["queued","starting","syncing_assets","preparing_image","classifying_ai","validating_result","saving_suggestion","writing_results"]);

export default function Jobs() {
  const qc = useQueryClient();
  const isPageVisible = usePageVisible();
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", typeFilter],
    queryFn: () => getJobs({ job_type: typeFilter || undefined, limit: 50 }),
    refetchInterval: (query) => {
      const currentJobs = query.state.data ?? [];
      return isPageVisible && currentJobs.some((job) => ACTIVE.has(job.status) || job.status === "paused")
        ? 3_000
        : false;
    },
  });
  const hasActiveJob = jobs.some((job) => ACTIVE.has(job.status) || job.status === "paused");

  const syncMut = useMutation({
    mutationFn: (mode: SyncMode) => startSyncJob({
      scope: "all",
      quick_sync: mode === "quick",
      full_sync: mode === "full",
    }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["jobs"] }); setExpandedJobId(d.job_id); },
  });

  const routeMut = useMutation({
    mutationFn: (force: boolean) => startRoutingClassify({ force }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["jobs"] }); setExpandedJobId(d.job_id); },
  });

  const cancelMut  = useMutation({ mutationFn: cancelJob,  onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }) });
  const pauseMut   = useMutation({ mutationFn: pauseJob,   onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }) });
  const resumeMut  = useMutation({ mutationFn: resumeJob,  onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }) });
  const deleteMut  = useMutation({
    mutationFn: deleteJob,
    onSuccess: () => { setConfirmDeleteId(null); qc.invalidateQueries({ queryKey: ["jobs"] }); },
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <MobileSidebarToggle />
            <h1 className={styles.title}>Jobs</h1>
          </div>
          <p className={styles.subtitle}>Background sync and routing classification jobs</p>
        </div>
        <div className={styles.actions}>
          <RunSyncButton
            label="Quick Sync"
            pending={syncMut.isPending || hasActiveJob}
            onRun={(fullSync) => syncMut.mutate(fullSync)}
          />
          <RunRoutingButton
            label="Run Routing"
            pending={routeMut.isPending || hasActiveJob}
            onRun={(force) => routeMut.mutate(force)}
            primary
          />
        </div>
      </div>

      <div className={styles.filter}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={styles.filterSelect}>
          <option value="">All types</option>
          <option value="asset_sync">Asset Sync</option>
          <option value="routing_classification">Routing Classification</option>
        </select>
      </div>

      {isLoading ? (
        <div className={styles.loading}>Loading…</div>
      ) : jobs.length === 0 ? (
        <div className={styles.empty}>No jobs yet.</div>
      ) : (
        <div className={styles.jobList}>
          {jobs.map((job) => {
            const isActive   = ACTIVE.has(job.status);
            const isPaused   = job.status === "paused";
            const isTerminal = TERMINAL.has(job.status);

            return (
              <div key={job.id} className={styles.jobCard}>
                <div
                  className={styles.jobCardHeader}
                  onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                >
                  <div style={{ flex: 1 }}><JobProgressBar job={job} compact /></div>
                  <div className={styles.jobActions}>
                    {isActive && (
                      <button onClick={(e) => { e.stopPropagation(); pauseMut.mutate(job.id); }} title="Pause" className={styles.iconBtn}>
                        <Pause size={13} color="var(--color-warning)" />
                      </button>
                    )}
                    {isPaused && (
                      <button onClick={(e) => { e.stopPropagation(); resumeMut.mutate(job.id); }} title="Resume" className={styles.iconBtn}>
                        <RotateCcw size={13} color="var(--color-success)" />
                      </button>
                    )}
                    {(isActive || isPaused) && (
                      <button onClick={(e) => { e.stopPropagation(); cancelMut.mutate(job.id); }} title="Cancel" className={styles.iconBtn}>
                        <XCircle size={13} color="var(--color-error)" />
                      </button>
                    )}
                    {isTerminal && (
                      confirmDeleteId === job.id ? (
                        <div className={styles.confirmRow} onClick={(e) => e.stopPropagation()}>
                          <span className={styles.confirmText}>Delete?</span>
                          <button onClick={() => deleteMut.mutate(job.id)} className={styles.confirmYes}>Yes</button>
                          <button onClick={() => setConfirmDeleteId(null)} className={styles.confirmNo}>No</button>
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(job.id); }} title="Delete" className={styles.iconBtn}>
                          <Trash2 size={13} color="var(--color-error)" />
                        </button>
                      )
                    )}
                    {expandedJobId === job.id ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                  </div>
                </div>
                {expandedJobId === job.id && (
                  <div className={styles.jobCardDetail}><JobDetail jobId={job.id} /></div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
