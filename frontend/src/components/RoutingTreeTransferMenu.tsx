import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Settings2, Upload } from "lucide-react";

import {
  exportRoutingTreeSettings,
  importRoutingTreeSettings,
} from "../services/api";
import type { RoutingTreeSettings } from "../types";


interface Props {
  onImported: () => void;
  onError: (message: string) => void;
}

function readFileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read import file"));
    reader.readAsText(file);
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Routing Tree settings transfer failed";
}

function parseImport(raw: string): RoutingTreeSettings {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object") {
    throw new Error("Import file must contain a JSON object");
  }
  const candidate = data as Partial<RoutingTreeSettings>;
  if (candidate.version !== 1 || !Array.isArray(candidate.nodes)) {
    throw new Error("Unsupported Routing Tree settings file");
  }
  return candidate as RoutingTreeSettings;
}

export default function RoutingTreeTransferMenu({ onImported, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const exportSettings = async () => {
    setPending(true);
    try {
      const settings = await exportRoutingTreeSettings();
      const blob = new Blob([`${JSON.stringify(settings, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "routing-tree-settings.json";
      link.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const importSettings = async (file: File) => {
    setPending(true);
    try {
      const settings = parseImport(await readFileText(file));
      await importRoutingTreeSettings(settings);
      setOpen(false);
      onImported();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const menuItemStyle = {
    display: "flex",
    alignItems: "flex-start",
    width: "100%",
    gap: 8,
    padding: "9px 10px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#e2e8f0",
    cursor: "pointer",
    textAlign: "left" as const,
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label="Routing Tree settings options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          border: "1px solid #334155",
          borderRadius: 8,
          background: "#1e293b",
          color: "#cbd5e1",
          fontSize: 13,
          fontWeight: 600,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        <Settings2 size={13} />
        Tree settings
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 30,
            width: 290,
            padding: 6,
            border: "1px solid #334155",
            borderRadius: 8,
            background: "#0f172a",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            style={menuItemStyle}
            onClick={() => {
              setOpen(false);
              inputRef.current?.click();
            }}
          >
            <Upload size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              <strong style={{ display: "block", fontSize: 12 }}>Import settings</strong>
              <small style={{ display: "block", marginTop: 2, color: "#64748b", fontSize: 10 }}>
                Replace every root and leaf after confirmation.
              </small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            style={menuItemStyle}
            onClick={() => void exportSettings()}
          >
            <Download size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              <strong style={{ display: "block", fontSize: 12 }}>Export settings</strong>
              <small style={{ display: "block", marginTop: 2, color: "#64748b", fontSize: 10 }}>
                Download the complete root and leaf configuration.
              </small>
            </span>
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        aria-label="Import Routing Tree settings file"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (
            file
            && window.confirm(
              "Import will override the current Routing Tree settings. Continue?",
            )
          ) {
            void importSettings(file);
          }
          event.target.value = "";
        }}
      />
    </div>
  );
}
