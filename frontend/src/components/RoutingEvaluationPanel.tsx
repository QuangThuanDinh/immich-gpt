import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  ChevronDown,
  Download,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import {
  getRoutingEvaluation,
  getRoutingPreferences,
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

interface RoutingEvaluationExport {
  version: 1;
  items: RoutingEvaluationItemInput[];
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

function exportConfigs(rows: EvaluationRow[]): RoutingEvaluationItemInput[] {
  return configs(rows).map(({
    immich_id,
    expected_tag,
    expected_absent_tag,
    expected_destination,
  }) => ({
    immich_id,
    expected_tag,
    expected_absent_tag,
    expected_destination,
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

function readFileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read import file"));
    reader.readAsText(file);
  });
}

function parseEvaluationImport(raw: string): RoutingEvaluationItemInput[] {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object") {
    throw new Error("Import file must contain a JSON object");
  }
  const candidate = data as Partial<RoutingEvaluationExport>;
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) {
    throw new Error("Unsupported Evaluation settings file");
  }
  if (candidate.items.length > 100) {
    throw new Error("Evaluation settings cannot contain more than 100 items");
  }
  return candidate.items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Item ${index + 1} is invalid`);
    }
    const value = item as unknown as Record<string, unknown>;
    const immichId = typeof value.immich_id === "string"
      ? value.immich_id.trim()
      : "";
    if (!immichId) {
      throw new Error(`Item ${index + 1} requires an image ID`);
    }
    const expectedTag = typeof value.expected_tag === "string"
      ? value.expected_tag
      : null;
    const expectedAbsentTag = typeof value.expected_absent_tag === "string"
      ? value.expected_absent_tag
      : null;
    if (invalidTagList(expectedTag) || invalidTagList(expectedAbsentTag)) {
      throw new Error(
        `Item ${index + 1} has invalid tags; separate tags with commas and do not use spaces inside tags`,
      );
    }
    return {
      immich_id: immichId,
      expected_tag: normalizeTagList(expectedTag),
      expected_absent_tag: normalizeTagList(expectedAbsentTag),
      expected_destination: typeof value.expected_destination === "string"
        ? value.expected_destination.trim() || null
        : null,
    };
  });
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
  const [activeItemIds, setActiveItemIds] = useState<Set<string>>(() => new Set());
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const transferMenuRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const preferencesQuery = useQuery({
    queryKey: ["routing-preferences"],
    queryFn: getRoutingPreferences,
  });

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

  const importMutation = useMutation({
    mutationFn: (items: RoutingEvaluationItemInput[]) => saveRoutingEvaluation(items),
    onSuccess: applyResponse,
    onError: (error) => setRequestError(errorMessage(error)),
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const total = rows.length;
      let state = await startRoutingEvaluation(configs(rows));
      applyResponse(state);
      const itemIds = state.items.map((item) => item.id);
      const concurrency = Math.min(
        preferencesQuery.data?.processing_concurrency ?? 1,
        itemIds.length,
      );
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < itemIds.length) {
          const index = nextIndex;
          nextIndex += 1;
          const itemId = itemIds[index];
          setEvaluationProgress({ current: index + 1, total });
          setActiveItemIds((current) => new Set(current).add(itemId));
          try {
            const response = await runRoutingEvaluationItem(itemId);
            const completedItem = response.items.find((item) => item.id === itemId);
            if (completedItem) {
              const completedRow = toRows({ items: [completedItem] })[0];
              setRows((current) => current.map((row) => (
                row.id === itemId ? completedRow : row
              )));
            }
            setSummary((current) => ({
              total_score: Math.max(current.total_score ?? 0, response.total_score ?? 0),
              max_score: response.max_score,
              evaluated_at: response.evaluated_at,
            }));
          } finally {
            setActiveItemIds((current) => {
              const next = new Set(current);
              next.delete(itemId);
              return next;
            });
          }
        }
      };

      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, () => worker()),
      );
      state = await getRoutingEvaluation();
      applyResponse(state);
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) {
        throw failure.reason;
      }
      return state;
    },
    onError: (error) => setRequestError(errorMessage(error)),
    onSettled: () => setEvaluationProgress(null),
  });

  const busy = saveMutation.isPending
    || importMutation.isPending
    || evaluateMutation.isPending;
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

  useEffect(() => {
    if (!transferMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!transferMenuRef.current?.contains(event.target as Node)) {
        setTransferMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTransferMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [transferMenuOpen]);

  const exportSettings = () => {
    const payload: RoutingEvaluationExport = {
      version: 1,
      items: exportConfigs(rows),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "routing-evaluation-settings.json";
    link.click();
    URL.revokeObjectURL(url);
    setTransferMenuOpen(false);
  };

  const importSettings = async (file: File) => {
    try {
      const imported = parseEvaluationImport(await readFileText(file));
      await importMutation.mutateAsync(imported);
    } catch (error) {
      setRequestError(errorMessage(error));
    }
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
            <div className={styles.evaluateGroup} ref={transferMenuRef}>
              <button
                type="button"
                className={`${styles.button} ${styles.evaluate} ${styles.evaluateMain}`}
                onClick={() => evaluateMutation.mutate()}
                disabled={!rows.length || !valid || busy}
              >
                <Play size={14} /> {evaluationProgress
                  ? `Evaluating ${evaluationProgress.current} of ${evaluationProgress.total}`
                  : "Evaluate Routing"}
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.evaluate} ${styles.evaluateToggle}`}
                aria-label="Evaluation settings options"
                aria-haspopup="menu"
                aria-expanded={transferMenuOpen}
                onClick={() => setTransferMenuOpen((open) => !open)}
                disabled={busy}
              >
                <ChevronDown size={14} />
              </button>
              {transferMenuOpen && (
                <div className={styles.evaluationMenu} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setTransferMenuOpen(false);
                      importInputRef.current?.click();
                    }}
                  >
                    <Upload size={14} />
                    <span>
                      <strong>Import settings</strong>
                      <small>Replace and save the current Evaluation list.</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={exportSettings}
                  >
                    <Download size={14} />
                    <span>
                      <strong>Export settings</strong>
                      <small>Download configuration only, without results or scores.</small>
                    </span>
                  </button>
                </div>
              )}
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                aria-label="Import Evaluation settings file"
                className={styles.fileInput}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (
                    file
                    && window.confirm(
                      "Import will override the current Evaluation settings. Continue?",
                    )
                  ) {
                    void importSettings(file);
                  }
                  event.target.value = "";
                }}
              />
            </div>
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
                {row.id && activeItemIds.has(row.id) && (
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
