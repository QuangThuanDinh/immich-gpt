import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { LoaderCircle, Play, Plus, Save, Trash2 } from "lucide-react";

import {
  getRoutingEvaluation,
  runRoutingEvaluationItem,
  saveRoutingEvaluation,
  startRoutingEvaluation,
} from "../services/api";
import {
  ROUTING_EVALUATION_TRASH,
  type RoutingEvaluation,
  type RoutingEvaluationItem,
  type RoutingEvaluationItemInput,
} from "../types";
import styles from "./RoutingEvaluationPanel.module.css";


interface EvaluationRow extends RoutingEvaluationItemInput {
  clientKey: string;
  result_description?: string | null;
  result_tags: string[];
  result_destination?: string | null;
  result_disposition?: string | null;
  tag_matched?: boolean | null;
  absent_tag_matched?: boolean | null;
  destination_matched?: boolean | null;
  score?: number | null;
  max_score?: number | null;
  error_message?: string | null;
  evaluated_at?: string | null;
}

interface Props {
  destinations: string[];
}

interface EditorProps extends Props {
  initialData: RoutingEvaluation;
}

let nextClientKey = 0;

function newClientKey() {
  nextClientKey += 1;
  return `evaluation-row-${nextClientKey}`;
}

function toRows(data: RoutingEvaluation): EvaluationRow[] {
  return data.items.map((item: RoutingEvaluationItem) => ({
    ...item,
    clientKey: item.id,
  }));
}

function configs(rows: EvaluationRow[]): RoutingEvaluationItemInput[] {
  return rows.map(({ id, immich_id, expected_tag, expected_absent_tag, expected_destination }) => ({
    ...(id ? { id } : {}),
    immich_id: immich_id.trim(),
    expected_tag: normalizeTagList(expected_tag),
    expected_absent_tag: normalizeTagList(expected_absent_tag),
    expected_destination: expected_destination || null,
  }));
}

function normalizeTagList(value?: string | null) {
  const tags = (value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
  return tags.length ? tags.join(",") : null;
}

function invalidTagList(value?: string | null) {
  if (!value?.trim()) return false;
  const tags = value.split(",");
  return tags.some((tag) => !tag.trim() || /\s/.test(tag.trim()));
}

function snapshot(rows: EvaluationRow[]) {
  return JSON.stringify(configs(rows));
}

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail ?? error.message;
  }
  return error instanceof Error ? error.message : "Evaluation request failed";
}

function destinationLabel(value?: string | null) {
  if (!value) return "No destination";
  if (value === ROUTING_EVALUATION_TRASH) return "Trash";
  return value.split("/").join(" / ");
}

export default function RoutingEvaluationPanel({ destinations }: Props) {
  const query = useQuery({
    queryKey: ["routing-evaluation"],
    queryFn: getRoutingEvaluation,
  });

  if (query.isLoading) {
    return (
      <section className={styles.panel} aria-labelledby="routing-evaluation-title">
        <h2 id="routing-evaluation-title" className={styles.title}>Evaluation</h2>
        <div className={styles.empty} style={{ marginTop: 18 }}>Loading evaluation items…</div>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className={styles.panel} aria-labelledby="routing-evaluation-title">
        <h2 id="routing-evaluation-title" className={styles.title}>Evaluation</h2>
        <div className={styles.error} style={{ marginTop: 18 }}>{errorMessage(query.error)}</div>
      </section>
    );
  }

  return (
    <EvaluationEditor
      destinations={destinations}
      initialData={query.data ?? { items: [] }}
    />
  );
}

function EvaluationEditor({ destinations, initialData }: EditorProps) {
  const [initialRows] = useState(() => toRows(initialData));
  const [rows, setRows] = useState<EvaluationRow[]>(initialRows);
  const [baseline, setBaseline] = useState(() => snapshot(initialRows));
  const [summary, setSummary] = useState<Pick<RoutingEvaluation, "total_score" | "max_score" | "evaluated_at">>(initialData);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [evaluationProgress, setEvaluationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const dirty = snapshot(rows) !== baseline;
  const invalidRow = rows.find((row) => {
    return !row.immich_id.trim()
      || invalidTagList(row.expected_tag)
      || invalidTagList(row.expected_absent_tag);
  });
  const valid = !invalidRow;

  const applyResponse = (data: RoutingEvaluation) => {
    const nextRows = toRows(data);
    setRows(nextRows);
    setBaseline(snapshot(nextRows));
    setSummary(data);
    setRequestError(null);
  };

  const saveMutation = useMutation({
    mutationFn: () => saveRoutingEvaluation(configs(rows)),
    onSuccess: applyResponse,
    onError: (error) => setRequestError(errorMessage(error)),
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const total = rows.length;
      setEvaluationProgress({ current: 1, total });
      let state = await startRoutingEvaluation(configs(rows));
      applyResponse(state);
      for (let index = 0; index < state.items.length; index += 1) {
        setEvaluationProgress({ current: index + 1, total });
        state = await runRoutingEvaluationItem(state.items[index].id);
        applyResponse(state);
      }
      return state;
    },
    onError: (error) => setRequestError(errorMessage(error)),
    onSettled: () => setEvaluationProgress(null),
  });

  const busy = saveMutation.isPending || evaluateMutation.isPending;
  const sortedDestinations = useMemo(
    () => [...new Set(destinations)].sort((a, b) => a.localeCompare(b)),
    [destinations],
  );

  const updateRow = <K extends keyof EvaluationRow>(
    clientKey: string,
    key: K,
    value: EvaluationRow[K],
  ) => {
    setRows((current) => current.map((row) => (
      row.clientKey === clientKey ? { ...row, [key]: value } : row
    )));
  };

  const addRow = () => {
    setRows((current) => [
      {
        clientKey: newClientKey(),
        immich_id: "",
        expected_tag: null,
        expected_absent_tag: null,
        expected_destination: null,
        result_tags: [],
      },
      ...current,
    ]);
  };

  return (
    <section className={styles.panel} aria-labelledby="routing-evaluation-title">
      <div className={styles.header}>
        <div>
          <h2 id="routing-evaluation-title" className={styles.title}>Evaluation</h2>
          <p className={styles.subtitle}>
            Save representative images and compare dry-run AI routing against expected tags and destinations.
          </p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.actions}>
            <button type="button" className={`${styles.button} ${styles.add}`} onClick={addRow} disabled={busy}>
              <Plus size={14} /> Add item
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.save}`}
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || !valid || busy}
            >
              <Save size={14} /> {saveMutation.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.evaluate}`}
              onClick={() => evaluateMutation.mutate()}
              disabled={!rows.length || !valid || busy}
            >
              <Play size={14} /> {evaluationProgress
                ? `Evaluating ${evaluationProgress.current} of ${evaluationProgress.total}`
                : "Evaluate Routing"}
            </button>
          </div>
          <div className={styles.total}>
            Latest total: {summary.total_score == null ? "Not evaluated" : `${summary.total_score} / ${summary.max_score ?? 0}`}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>No evaluation items yet. Add an item to begin.</div>
      ) : (
        <div className={styles.list}>
          {rows.map((row, index) => (
            <article className={styles.item} key={row.clientKey}>
              <div className={styles.preview}>
                {row.immich_id.trim() ? (
                  <img
                    src={`/api/thumbnails/immich/${encodeURIComponent(row.immich_id.trim())}`}
                    alt={`Evaluation item ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className={styles.previewPlaceholder}>Enter an Immich image ID to preview it.</div>
                )}
                {evaluationProgress?.current === index + 1 && (
                  <div className={styles.loadingOverlay} aria-label={`Evaluating item ${index + 1}`}>
                    <LoaderCircle className={styles.spinner} size={34} />
                  </div>
                )}
              </div>

              <div className={styles.fields}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemTitle}>Item {index + 1}</span>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => setRows((current) => current.filter((item) => item.clientKey !== row.clientKey))}
                    disabled={busy}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${row.clientKey}-image`}>Image ID</label>
                  <input
                    id={`${row.clientKey}-image`}
                    className={styles.input}
                    value={row.immich_id}
                    onChange={(event) => updateRow(row.clientKey, "immich_id", event.target.value)}
                    placeholder="Immich asset ID"
                    disabled={busy}
                  />
                </div>

                <div className={styles.field}>
                  <label>Result description</label>
                  <div className={styles.result}>
                    {row.result_description || ""}
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${row.clientKey}-tag`}>Expect to have tags</label>
                  <input
                    id={`${row.clientKey}-tag`}
                    className={styles.input}
                    value={row.expected_tag ?? ""}
                    onChange={(event) => updateRow(row.clientKey, "expected_tag", event.target.value)}
                    placeholder="tag_one, tag_two"
                    disabled={busy}
                  />
                  <div className={`${styles.result} ${
                    row.tag_matched == null ? "" : row.tag_matched ? styles.match : styles.mismatch
                  }`}>
                    Result: {row.result_tags.length ? row.result_tags.join(", ") : "Not evaluated"}
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${row.clientKey}-absent-tag`}>Expect don't have tags</label>
                  <input
                    id={`${row.clientKey}-absent-tag`}
                    className={styles.input}
                    value={row.expected_absent_tag ?? ""}
                    onChange={(event) => updateRow(row.clientKey, "expected_absent_tag", event.target.value)}
                    placeholder="tag_one, tag_two"
                    disabled={busy}
                  />
                  <div className={`${styles.result} ${
                    row.absent_tag_matched == null
                      ? ""
                      : row.absent_tag_matched
                        ? styles.match
                        : styles.mismatch
                  }`}>
                    Result: {row.result_tags.length ? row.result_tags.join(", ") : "Not evaluated"}
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${row.clientKey}-destination`}>Expected album or trash</label>
                  <select
                    id={`${row.clientKey}-destination`}
                    className={styles.select}
                    value={row.expected_destination ?? ""}
                    onChange={(event) => updateRow(
                      row.clientKey,
                      "expected_destination",
                      event.target.value || null,
                    )}
                    disabled={busy}
                  >
                    <option value="">No expectation</option>
                    {sortedDestinations.map((path) => (
                      <option value={path} key={path}>{destinationLabel(path)}</option>
                    ))}
                  </select>
                  <div className={`${styles.result} ${
                    row.destination_matched == null
                      ? ""
                      : row.destination_matched
                        ? styles.match
                        : styles.mismatch
                  }`}>
                    Result: {row.result_destination == null
                      ? "Not evaluated"
                      : destinationLabel(row.result_destination)}
                  </div>
                </div>

                {row.error_message && <div className={styles.error}>{row.error_message}</div>}
                <div className={styles.score}>
                  Latest score: {row.score == null ? "Not evaluated" : `${row.score} / ${row.max_score ?? 0}`}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {requestError && <div className={styles.error} style={{ marginTop: 14 }}>{requestError}</div>}
      {!valid && (
        <div className={styles.error} style={{ marginTop: 14 }}>
          Every item requires an image ID. Separate tags with commas; individual tags cannot contain spaces.
        </div>
      )}

    </section>
  );
}
