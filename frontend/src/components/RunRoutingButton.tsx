import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, RotateCcw } from "lucide-react";
import styles from "./RunRoutingButton.module.css";

interface RunRoutingButtonProps {
  label: string;
  pending: boolean;
  onRun: (force: boolean) => void;
  primary?: boolean;
}

export default function RunRoutingButton({
  label,
  pending,
  onRun,
  primary = false,
}: RunRoutingButtonProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const focusItemOnOpenRef = useRef(false);
  const background = primary ? "#1e40af" : "#1e293b";
  const color = primary ? "white" : "#22c55e";

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        optionsButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open && focusItemOnOpenRef.current) {
      menuItemRef.current?.focus();
      focusItemOnOpenRef.current = false;
    }
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
      focusItemOnOpenRef.current = true;
    } else {
      setMenuStyle({});
    }
    setOpen((value) => !value);
  };

  const handleOptionsKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) {
      toggleMenu();
    } else {
      menuItemRef.current?.focus();
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      menuItemRef.current?.focus();
      return;
    }

    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      optionsButtonRef.current?.focus();
      return;
    }

    if (event.key === "Tab") setOpen(false);
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        onClick={() => onRun(false)}
        disabled={pending}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: "8px 0 0 8px",
          border: primary ? "none" : "1px solid #334155",
          borderRight: "1px solid rgba(255,255,255,0.18)",
          background,
          color,
          fontSize: 13,
          fontWeight: 600,
          cursor: pending ? "wait" : "pointer",
        }}
      >
        <Play size={13} /> {label}
      </button>
      <button
        ref={optionsButtonRef}
        type="button"
        aria-label={`${label} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
        onKeyDown={handleOptionsKeyDown}
        disabled={pending}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 9px",
          borderRadius: "0 8px 8px 0",
          border: primary ? "none" : "1px solid #334155",
          borderLeft: "none",
          background,
          color,
          cursor: pending ? "wait" : "pointer",
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
            ref={menuItemRef}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            onKeyDown={handleMenuKeyDown}
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
                Reprocess all assets
              </span>
              <span style={{ display: "block", marginTop: 2, color: "#64748b", fontSize: 10 }}>
                Includes previously routed and errored photos and may increase AI usage.
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
