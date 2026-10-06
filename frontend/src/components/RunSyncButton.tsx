import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import styles from "./RunRoutingButton.module.css";

interface RunSyncButtonProps {
  label: string;
  pending: boolean;
  onRun: (fullSync: boolean) => void;
}

export default function RunSyncButton({
  label,
  pending,
  onRun,
}: RunSyncButtonProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  const toggleMenu = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportPadding = 16;
      const menuWidth = Math.min(260, window.innerWidth - viewportPadding * 2);
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding),
      );
      const openAbove = window.innerHeight - rect.bottom < 120;

      setMenuStyle({
        position: "fixed",
        left,
        right: "auto",
        width: menuWidth,
        top: openAbove ? "auto" : rect.bottom + 6,
        bottom: openAbove ? window.innerHeight - rect.top + 6 : "auto",
      });
    } else {
      setMenuStyle({});
    }
    setOpen((value) => !value);
  };

  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    background: "#1e40af",
    color: "white",
    fontSize: 13,
    fontWeight: 600,
    cursor: pending ? "wait" : "pointer",
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        type="button"
        onClick={() => onRun(false)}
        disabled={pending}
        style={{
          ...buttonStyle,
          gap: 6,
          padding: "8px 12px",
          border: "none",
          borderRight: "1px solid rgba(255,255,255,0.18)",
          borderRadius: "8px 0 0 8px",
        }}
      >
        <RefreshCw size={13} /> {label}
      </button>
      <button
        type="button"
        aria-label={`${label} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
        disabled={pending}
        style={{
          ...buttonStyle,
          padding: "8px 9px",
          border: "none",
          borderLeft: "none",
          borderRadius: "0 8px 8px 0",
        }}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className={styles.menu}
          style={{
            ...menuStyle,
            padding: 6,
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#0f172a",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRun(true);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "9px 10px",
              border: "none",
              borderRadius: 6,
              background: "transparent",
              color: "#e2e8f0",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <RotateCcw size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600 }}>
                Full Sync
              </span>
              <span style={{ display: "block", marginTop: 2, color: "#64748b", fontSize: 10 }}>
                Re-read detailed metadata and faces for every selected asset.
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
