import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  getAssets, getAssetCount, getThumbnailUrl,
} from "../services/api";
import type { Asset } from "../types";
import AssetDetailPanel from "../components/AssetDetailPanel";
import MobileSidebarToggle from "../components/MobileSidebarToggle";
import {
  Search, Image as ImageIcon, ArrowUp, ArrowDown, ArrowUpDown,
  Star,
} from "lucide-react";

const PAGE_SIZE = 24;

type SortKey = "date" | "filename" | "location" | "tags" | "type";
type SortDir = "asc" | "desc";

function SortHeader({ label, sortKey, current, dir, onChange }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onChange: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <button onClick={() => onChange(sortKey)} style={{
      display: "flex", alignItems: "center", gap: 4,
      background: active ? "rgba(56,189,248,0.08)" : "transparent",
      border: "none", cursor: "pointer",
      color: active ? "#38bdf8" : "#64748b",
      fontSize: 12, fontWeight: active ? 600 : 400, padding: "4px 8px", borderRadius: 6,
    }}>
      {label}
      {active ? (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} />}
    </button>
  );
}

function AssetCard({ asset, onClick }: { asset: Asset; onClick: () => void }) {
  const [imgError, setImgError] = React.useState(false);
  const location = [asset.city, asset.country].filter(Boolean).join(", ");
  return (
    <div
      onClick={onClick}
      style={{
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 10, overflow: "hidden", cursor: "pointer",
        transition: "border-color 0.15s", position: "relative",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#38bdf8"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; }}
    >
      <div style={{ width: "100%", aspectRatio: "1", background: "#0f172a", position: "relative", overflow: "hidden" }}>
        {imgError ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ImageIcon size={28} color="#334155" />
          </div>
        ) : (
          <img
            src={getThumbnailUrl(asset.id)}
            alt={asset.original_filename || ""}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {asset.is_favorite && (
          <Star size={12} color="#fbbf24" fill="#fbbf24" style={{ position: "absolute", top: 6, right: 6 }} />
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {asset.original_filename || asset.immich_id}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
          {asset.asset_type && (
            <span style={{ fontSize: 9, background: "#0ea5e918", color: "#38bdf8", border: "1px solid #0ea5e930", borderRadius: 4, padding: "1px 5px" }}>
              {asset.asset_type}
            </span>
          )}
          {location && <span style={{ fontSize: 9, color: "#64748b" }}>{location}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Assets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null);

  const page = parseInt(searchParams.get("page") || "1", 10);
  const assetType = searchParams.get("type") || "";
  const search = searchParams.get("q") || "";
  const sortKey = (searchParams.get("sort") as SortKey) || "date";
  const sortDir = (searchParams.get("dir") as SortDir) || "desc";
  const [searchInput, setSearchInput] = React.useState(search);
  React.useEffect(() => { setSearchInput(search); }, [search]);

  function setParam(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.set("page", "1");
      return next;
    });
  }

  function setSort(key: SortKey) {
    if (key === sortKey) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("dir", sortDir === "asc" ? "desc" : "asc");
        return next;
      });
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("sort", key);
        next.set("dir", "desc");
        return next;
      });
    }
  }

  const queryParams = {
    page,
    page_size: PAGE_SIZE,
    asset_type: assetType || undefined,
    q: search || undefined,
    sort: sortKey,
    dir: sortDir,
  };

  const countQueryParams = {
    asset_type: assetType || undefined,
    q: search || undefined,
  };

  const { data: assets = [], isLoading, isError: assetsError } = useQuery<Asset[]>({
    queryKey: ["assets", queryParams],
    queryFn: () => getAssets(queryParams),
  });

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["asset-count", countQueryParams],
    queryFn: () => getAssetCount(countQueryParams),
  });

  const total = countData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selected = assets.find((a) => a.id === selectedAssetId);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam("q", searchInput.trim());
  }

  return (
    <div data-testid="assets-page" style={{ padding: "32px 40px", maxWidth: 1400 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MobileSidebarToggle />
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>Assets</h1>
        </div>
        <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>
          Browse synced Immich assets. Routing decisions live under{" "}
          <a href="/routing/plans" style={{ color: "#38bdf8" }}>Routing plans</a>.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <form onSubmit={submitSearch} style={{ flex: "1 1 240px", display: "flex", alignItems: "center", gap: 6, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px" }}>
          <Search size={14} color="#64748b" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search filename, description, location…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e2e8f0", fontSize: 13 }}
          />
        </form>
        <select
          value={assetType}
          onChange={(e) => setParam("type", e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", fontSize: 13 }}
        >
          <option value="">Any type</option>
          <option value="IMAGE">Image</option>
          <option value="VIDEO">Video</option>
        </select>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <SortHeader label="Date" sortKey="date" current={sortKey} dir={sortDir} onChange={setSort} />
          <SortHeader label="Filename" sortKey="filename" current={sortKey} dir={sortDir} onChange={setSort} />
          <SortHeader label="Location" sortKey="location" current={sortKey} dir={sortDir} onChange={setSort} />
          <SortHeader label="Type" sortKey="type" current={sortKey} dir={sortDir} onChange={setSort} />
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading assets…</div>
      ) : assetsError ? (
        <div style={{ padding: 60, textAlign: "center", color: "#fca5a5", fontSize: 13 }}>Failed to load assets.</div>
      ) : assets.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "#64748b", fontSize: 13 }}>
          No assets match the current filter. Sync your Immich library from the dashboard.
        </div>
      ) : (
        <div data-testid="assets-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onClick={() => setSelectedAssetId(asset.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 24 }}>
          <button
            onClick={() => setParam("page", String(Math.max(1, page - 1)))}
            disabled={page <= 1}
            style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: page > 1 ? "pointer" : "not-allowed", fontSize: 12, opacity: page > 1 ? 1 : 0.4 }}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: "#64748b", padding: "5px 12px" }}>
            Page {page} of {totalPages} · {total.toLocaleString()} total
          </span>
          <button
            onClick={() => setParam("page", String(Math.min(totalPages, page + 1)))}
            disabled={page >= totalPages}
            style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: page < totalPages ? "pointer" : "not-allowed", fontSize: 12, opacity: page < totalPages ? 1 : 0.4 }}
          >
            Next
          </button>
        </div>
      )}

      {selectedAssetId && (
        <AssetDetailPanel
          assetId={selectedAssetId}
          initialAsset={selected}
          onClose={() => setSelectedAssetId(null)}
        />
      )}
    </div>
  );
}
