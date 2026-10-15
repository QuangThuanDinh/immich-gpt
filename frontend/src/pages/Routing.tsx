import React, { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRoutingTree,
  createRoutingNode,
  updateRoutingNode,
  deleteRoutingNode,
  duplicateRoutingNode,
  startRoutingClassify,
} from "../services/api";
import type { RoutingNode } from "../types";
import RoutingLeafEditor from "../components/RoutingLeafEditor";
import RoutingEvaluationPanel from "../components/RoutingEvaluationPanel";
import RoutingTreeTransferMenu from "../components/RoutingTreeTransferMenu";
import RunRoutingButton from "../components/RunRoutingButton";
import MobileSidebarToggle from "../components/MobileSidebarToggle";
import masterDetail from "../styles/MasterDetail.module.css";
import styles from "./Routing.module.css";
import {
  Plus,
  Trash2,
  Copy,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderTree,
} from "lucide-react";

const inputStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 8,
  color: "#f1f5f9",
  fontSize: 13,
  padding: "8px 12px",
  outline: "none",
};

interface NodeRowProps {
  node: RoutingNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  focusedId: string | null;
  onFocusNode: (id: string) => void;
  onNodeKeyDown: (node: RoutingNode, event: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocusNextNode: (id: string) => void;
  registerNode: (id: string, element: HTMLDivElement | null) => void;
}

function NodeRow({
  node,
  depth,
  expanded,
  toggle,
  selectedId,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
  focusedId,
  onFocusNode,
  onNodeKeyDown,
  onFocusNextNode,
  registerNode,
}: NodeRowProps) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const isLeaf = node.is_leaf;
  const isSelected = selectedId === node.id;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const buttons = buttonRefs.current.filter(
        (button): button is HTMLButtonElement => button !== null,
      );
      const target = event.key === "ArrowRight" ? buttons[0] : buttons[buttons.length - 1];
      target?.focus();
      return;
    }
    onNodeKeyDown(node, event);
  };

  const handleButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    buttonIndex: number,
  ) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      rowRef.current?.focus();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (buttonIndex === 0) rowRef.current?.focus();
      else buttonRefs.current[buttonIndex - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const nextButton = buttonRefs.current[buttonIndex + 1];
      if (nextButton) nextButton.focus();
      else onFocusNextNode(node.id);
    }
  };

  return (
    <div role="none">
      <div
        ref={(element) => {
          rowRef.current = element;
          registerNode(node.id, element);
        }}
        role="treeitem"
        aria-label={node.name}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-level={depth + 1}
        tabIndex={focusedId === node.id ? 0 : -1}
        className={styles.nodeRow}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: `6px 8px 6px ${depth * 16 + 4}px`,
          borderRadius: 6,
          background: isSelected ? "rgba(59,130,246,0.12)" : "transparent",
          cursor: "pointer",
          opacity: node.enabled ? 1 : 0.55,
          marginBottom: 2,
        }}
        onFocus={() => onFocusNode(node.id)}
        onKeyDown={handleRowKeyDown}
        onClick={() => {
          onFocusNode(node.id);
          onSelect(node.id);
        }}
      >
        {hasChildren ? (
          <button
            ref={(element) => { buttonRefs.current[0] = element; }}
            type="button"
            tabIndex={-1}
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className={styles.nodeActionButton}
            onKeyDown={(event) => handleButtonKeyDown(event, 0)}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
            style={{
              width: 20,
              padding: 0,
              background: "transparent",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className={masterDetail.leafSpacer} aria-hidden="true" />
        )}
        {isLeaf ? <Folder size={14} color="#38bdf8" /> : <FolderTree size={14} color="#a78bfa" />}
        <div style={{ flex: 1, fontSize: 13, color: "#e2e8f0" }}>
          {node.name}
          <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
            {node.path}
          </span>
        </div>
        {node.destination_type !== "virtual" && (
          <span style={{
            fontSize: 10,
            color: "#38bdf8",
            background: "rgba(56,189,248,0.1)",
            padding: "1px 6px",
            borderRadius: 4,
          }}>
            {node.destination_type}
          </span>
        )}
        {node.auto_apply_enabled && (
          <span style={{
            fontSize: 10,
            color: "#22c55e",
            background: "rgba(34,197,94,0.1)",
            padding: "1px 6px",
            borderRadius: 4,
          }}>auto</span>
        )}
        <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button
            ref={(element) => { buttonRefs.current[hasChildren ? 1 : 0] = element; }}
            type="button"
            tabIndex={-1}
            aria-label={`Add child to ${node.name}`}
            title="Add child"
            className={styles.nodeActionButton}
            onKeyDown={(event) => handleButtonKeyDown(event, hasChildren ? 1 : 0)}
            onClick={() => onAddChild(node.id)}
            style={{ padding: 4, background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}
          >
            <Plus size={13} />
          </button>
          <button
            ref={(element) => { buttonRefs.current[hasChildren ? 2 : 1] = element; }}
            type="button"
            tabIndex={-1}
            aria-label={`Duplicate ${node.name}`}
            title="Duplicate"
            className={styles.nodeActionButton}
            onKeyDown={(event) => handleButtonKeyDown(event, hasChildren ? 2 : 1)}
            onClick={() => onDuplicate(node.id)}
            style={{ padding: 4, background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}
          >
            <Copy size={13} />
          </button>
          <button
            ref={(element) => { buttonRefs.current[hasChildren ? 3 : 2] = element; }}
            type="button"
            tabIndex={-1}
            aria-label={`Delete ${node.name}`}
            title="Delete"
            className={styles.nodeActionButton}
            onKeyDown={(event) => handleButtonKeyDown(event, hasChildren ? 3 : 2)}
            onClick={() => onDelete(node.id)}
            style={{ padding: 4, background: "transparent", border: "none", color: "#ef4444", cursor: "pointer" }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {isOpen && hasChildren && (
        <div role="group">
          {node.children!.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              focusedId={focusedId}
              onFocusNode={onFocusNode}
              onNodeKeyDown={onNodeKeyDown}
              onFocusNextNode={onFocusNextNode}
              registerNode={registerNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Routing() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["routing-tree"], queryFn: getRoutingTree });
  const tree = useMemo(() => data?.nodes ?? [], [data]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [transferError, setTransferError] = useState<string | null>(null);

  const flat = useMemo(() => flatten(tree), [tree]);
  const visibleNodes = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const activeFocusedNodeId = visibleNodes.some((node) => node.id === focusedNodeId)
    ? focusedNodeId
    : visibleNodes[0]?.id ?? null;
  const selected = flat.find((n) => n.id === selectedId) ?? null;

  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState("");

  const createMut = useMutation({
    mutationFn: createRoutingNode,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["routing-tree"] });
      setCreatingUnder(undefined);
      setNewName("");
      setSelectedId(created.id);
    },
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) =>
      deleteRoutingNode(id, cascade),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routing-tree"] });
      setSelectedId(null);
    },
  });

  const dupMut = useMutation({
    mutationFn: duplicateRoutingNode,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-tree"] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RoutingNode> }) =>
      updateRoutingNode(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-tree"] }),
  });

  const classifyMut = useMutation({
    mutationFn: (force: boolean) => startRoutingClassify({ force }),
    onSuccess: (r) => {
      alert(`Routing classification started.\nJob: ${r.job_id}\nPlan: ${r.plan_id}`);
    },
  });

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const focusNode = (id: string) => {
    setFocusedNodeId(id);
    nodeRefs.current[id]?.focus();
  };

  const handleNodeKeyDown = (
    node: RoutingNode,
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    const index = visibleNodes.findIndex((visible) => visible.id === node.id);
    if (index < 0) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(node.id);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusNode(visibleNodes[(index + 1) % visibleNodes.length].id);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNode(visibleNodes[(index - 1 + visibleNodes.length) % visibleNodes.length].id);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusNode(visibleNodes[0].id);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusNode(visibleNodes[visibleNodes.length - 1].id);
      return;
    }
  };

  const focusNextNode = (nodeId: string) => {
    const index = visibleNodes.findIndex((node) => node.id === nodeId);
    if (index >= 0 && index < visibleNodes.length - 1) {
      focusNode(visibleNodes[index + 1].id);
    }
  };

  const handleAddRoot = () => {
    setCreatingUnder(null);
    setNewName("");
  };

  const handleAddChild = (parentId: string) => {
    setCreatingUnder(parentId);
    const next = new Set(expanded);
    next.add(parentId);
    setExpanded(next);
    setNewName("");
  };

  const handleDelete = (id: string) => {
    const node = flat.find((n) => n.id === id);
    if (!node) return;
    const hasChildren = (node.children?.length ?? 0) > 0;
    const msg = hasChildren
      ? `Delete '${node.name}' and all its children?`
      : `Delete '${node.name}'?`;
    if (confirm(msg)) {
      deleteMut.mutate({ id, cascade: hasChildren });
    }
  };

  const submitCreate = () => {
    if (!newName.trim()) return;
    createMut.mutate({
      name: newName.trim(),
      parent_id: creatingUnder ?? null,
    });
  };

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
      <div className={masterDetail.pageHeader} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className={masterDetail.titleRow}>
            <MobileSidebarToggle />
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>Routing tree</h1>
          </div>
          <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>
            Where should each photo go? Manage destinations, rules, and automation.
          </p>
        </div>
        <div className={masterDetail.pageActions} style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleAddRoot}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: "#16a34a", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Plus size={13} /> Add Root
          </button>
          <RoutingTreeTransferMenu
            onImported={() => {
              setSelectedId(null);
              setExpanded(new Set());
              setTransferError(null);
              void qc.invalidateQueries({ queryKey: ["routing-tree"] });
            }}
            onError={setTransferError}
          />
          <RunRoutingButton
            label="Run Routing"
            pending={classifyMut.isPending}
            onRun={(force) => classifyMut.mutate(force)}
            primary
          />
        </div>
      </div>

      {transferError && (
        <div style={{
          marginBottom: 14,
          padding: "8px 10px",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 7,
          background: "rgba(127,29,29,0.18)",
          color: "#fca5a5",
          fontSize: 12,
        }}>
          {transferError}
        </div>
      )}

      <div className={masterDetail.layout}>
        <div className={[masterDetail.master, masterDetail.flushMaster, selected ? masterDetail.masterHidden : ""].join(" ")} style={{
          background: "#0f172a", border: "1px solid #1e293b",
          borderRadius: 12, padding: 16, minHeight: 400,
        }}>
          {isLoading ? (
            <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>
          ) : tree.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: 13 }}>
              No routing destinations yet. Click "Add Root" to create your first one.
            </div>
          ) : (
            <div role="tree" aria-label="Routing destinations">
              {tree.map((n) => (
                <NodeRow
                  key={n.id}
                  node={n}
                  depth={0}
                  expanded={expanded}
                  toggle={toggle}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onAddChild={handleAddChild}
                  onDuplicate={(id) => dupMut.mutate(id)}
                  onDelete={handleDelete}
                  focusedId={activeFocusedNodeId}
                  onFocusNode={setFocusedNodeId}
                  onNodeKeyDown={handleNodeKeyDown}
                  onFocusNextNode={focusNextNode}
                  registerNode={(id, element) => { nodeRefs.current[id] = element; }}
                />
              ))}
            </div>
          )}

          {creatingUnder !== undefined && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: "#1e293b", border: "1px solid #334155",
            }}>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
                {creatingUnder ? `New child of '${flat.find((f) => f.id === creatingUnder)?.path}'` : "New root node"}
              </div>
              <input
                autoFocus
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCreate();
                  if (e.key === "Escape") setCreatingUnder(undefined);
                }}
                style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={submitCreate}
                  disabled={!newName.trim() || createMut.isPending}
                  style={{
                    padding: "6px 14px", borderRadius: 6, border: "none",
                    background: "#1e40af", color: "white", fontSize: 12, fontWeight: 600,
                    cursor: !newName.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  Create
                </button>
                <button
                  onClick={() => setCreatingUnder(undefined)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, border: "1px solid #334155",
                    background: "transparent", color: "#64748b", fontSize: 12, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={[masterDetail.detail, selected ? "" : masterDetail.detailHidden].join(" ")}>
          <div style={{
          background: "#0f172a", border: "1px solid #1e293b",
          borderRadius: 12, padding: 0, minHeight: 400,
        }}>
          {selected ? (
            <RoutingLeafEditor
              key={selected.id}
              node={selected}
              onSave={(data) => updateMut.mutate({ id: selected.id, data })}
              saving={updateMut.isPending}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: 400, color: "#64748b", fontSize: 13,
            }}>
              <FolderTree size={36} color="#334155" />
              <div style={{ marginTop: 12 }}>Select a node to edit its settings.</div>
            </div>
          )}
          </div>
        </div>
      </div>
      <RoutingEvaluationPanel destinations={enabledLeafPaths(tree)} />
    </div>
  );
}

function flatten(nodes: RoutingNode[]): RoutingNode[] {
  const out: RoutingNode[] = [];
  const walk = (n: RoutingNode) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function flattenVisible(nodes: RoutingNode[], expanded: Set<string>): RoutingNode[] {
  const visible: RoutingNode[] = [];
  const walk = (node: RoutingNode) => {
    visible.push(node);
    if (expanded.has(node.id)) {
      (node.children ?? []).forEach(walk);
    }
  };
  nodes.forEach(walk);
  return visible;
}

function enabledLeafPaths(nodes: RoutingNode[], ancestorsEnabled = true): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    const enabled = ancestorsEnabled && node.enabled;
    if (enabled && node.is_leaf && node.destination_type !== "immich_trash") {
      paths.push(node.path);
    }
    paths.push(...enabledLeafPaths(node.children ?? [], enabled));
  }
  return paths;
}
