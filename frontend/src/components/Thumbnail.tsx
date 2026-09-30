import React, { useState } from "react";
import { Image } from "lucide-react";
import { getThumbnailUrl } from "../services/api";
import styles from "./Thumbnail.module.css";

interface Props {
  assetId: string;
  size?: number;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

export default function Thumbnail({
  assetId,
  size = 80,
  onClick,
  ariaLabel,
  className,
}: Props) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const rootStyle = { width: size, height: size };
  const iconSize = Math.round(size / 3);
  const interactiveProps = onClick ? {
    onClick,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    },
    role: "button",
    tabIndex: 0,
    "aria-label": ariaLabel ?? "View asset metadata",
  } : {};

  if (error) {
    return (
      <div
        className={[styles.root, onClick ? styles.rootClickable : "", className].filter(Boolean).join(" ")}
        style={rootStyle}
        {...interactiveProps}
      >
        <div className={styles.placeholder}>
          <Image size={iconSize} color="var(--text-faint)" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={[styles.root, onClick ? styles.rootClickable : "", className].filter(Boolean).join(" ")}
      style={rootStyle}
      {...interactiveProps}
    >
      {!loaded && (
        <div className={styles.placeholder}>
          <Image size={iconSize} color="var(--border)" />
        </div>
      )}
      <img
        src={getThumbnailUrl(assetId)}
        alt=""
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={styles.img}
        style={{ display: loaded ? "block" : "none" }}
      />
    </div>
  );
}
