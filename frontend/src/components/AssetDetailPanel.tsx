import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Calendar,
  Camera,
  Clock,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import {
  getAsset,
  getImmichSettings,
  getPersonThumbnailUrl,
  refreshAssetMetadata,
  getThumbnailUrl,
} from "../services/api";
import type { Asset, AssetPerson } from "../types";
import AssetAiQueryPanel from "./AssetAiQueryPanel";
import { useTimezone } from "../hooks/useTimezone";

function MetaRow({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
      <div style={{ color: "#475569", flexShrink: 0, marginTop: 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "#475569", fontWeight: 500, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13, color: "#e2e8f0", wordBreak: "break-word" }}>{value}</div>
      </div>
    </div>
  );
}

interface Props {
  assetId: string;
  initialAsset?: Asset;
  onClose: () => void;
}

function PersonCard({ assetId, person }: { assetId: string; person: AssetPerson }) {
  const [imgError, setImgError] = React.useState(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <div style={{
        width: 42, height: 42, borderRadius: "50%", overflow: "hidden",
        background: "#1e293b", border: "1px solid #334155", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {imgError ? (
          <UserRound size={18} color="#64748b" />
        ) : (
          <img
            src={getPersonThumbnailUrl(assetId, person.id)}
            alt={person.name}
            loading="lazy"
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
      <span style={{ color: "#e2e8f0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
        {person.name}
      </span>
    </div>
  );
}

function PeopleGrid({ asset }: { asset: Asset }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 4 }}>
      {(asset.people ?? []).map((person) => (
        <PersonCard key={person.id} assetId={asset.id} person={person} />
      ))}
    </div>
  );
}

function AssetImagePreview({ asset, imgError, onImageError }: {
  asset: Asset;
  imgError: boolean;
  onImageError: () => void;
}) {
  return (
    <div style={{ background: "#000", position: "relative", aspectRatio: "16/9", overflow: "hidden", flexShrink: 0 }}>
      {imgError ? (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ImageIcon size={48} color="#334155" />
        </div>
      ) : (
        <img
          src={getThumbnailUrl(asset.id, "preview")}
          alt={asset.original_filename || ""}
          decoding="async"
          onError={onImageError}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      )}
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6 }}>
        {asset.is_favorite && (
          <span style={{ background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "3px 7px", display: "flex", alignItems: "center", gap: 4 }}>
            <Star size={11} color="#fbbf24" fill="#fbbf24" />
          </span>
        )}
        {asset.is_archived && (
          <span style={{ background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "3px 7px", display: "flex", alignItems: "center", gap: 4 }}>
            <Archive size={11} color="#94a3b8" />
          </span>
        )}
        {asset.is_external_library && (
          <span style={{ background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "3px 7px", display: "flex", alignItems: "center", gap: 4 }}>
            <ExternalLink size={11} color="#94a3b8" />
          </span>
        )}
      </div>
      {asset.asset_type && (
        <span style={{
          position: "absolute", bottom: 8, right: 8,
          background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "3px 8px",
          fontSize: 11, fontWeight: 600, color: "#38bdf8",
        }}>
          {asset.asset_type}
        </span>
      )}
    </div>
  );
}

function AiAssetPreview({ asset, imgError, onImageError }: {
  asset: Asset;
  imgError: boolean;
  onImageError: () => void;
}) {
  return (
    <>
      <AssetImagePreview asset={asset} imgError={imgError} onImageError={onImageError} />
      {(asset.people ?? []).length > 0 && (
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e293b", background: "#0f172a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            <UserRound size={13} />
            People
          </div>
          <PeopleGrid asset={asset} />
        </div>
      )}
    </>
  );
}

export default function AssetDetailPanel({ assetId, initialAsset, onClose }: Props) {
  const [imgError, setImgError] = React.useState(false);
  const [aiQueryOpen, setAiQueryOpen] = React.useState(false);
  const { formatDateTime } = useTimezone();
  const queryClient = useQueryClient();
  const { data: asset, isLoading, isError } = useQuery<Asset>({
    queryKey: ["asset", assetId],
    queryFn: () => getAsset(assetId),
    initialData: initialAsset,
    enabled: !initialAsset,
  });
  const { data: immichSettings } = useQuery({
    queryKey: ["immich-settings"],
    queryFn: getImmichSettings,
    staleTime: 5 * 60 * 1000,
  });
  const refreshMutation = useMutation({
    mutationFn: () => refreshAssetMetadata(assetId),
    onSuccess: (refreshed) => {
      queryClient.setQueryData(["asset", assetId], refreshed);
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  React.useEffect(() => {
    setImgError(false);
  }, [assetId]);

  React.useEffect(() => {
    const main = document.querySelector<HTMLElement>("main");
    const previousBodyOverflow = document.body.style.overflow;
    const previousMainOverflow = main?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (main) main.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (main) main.style.overflow = previousMainOverflow;
    };
  }, []);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !aiQueryOpen) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [aiQueryOpen, onClose]);

  const location = asset
    ? [asset.city, asset.country].filter(Boolean).join(", ")
    : "";
  const immichAssetUrl = asset && immichSettings?.immich_url
    ? `${immichSettings.immich_url.replace(/\/+$/, "")}/photos/${encodeURIComponent(asset.immich_id)}`
    : null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Asset details"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(480px, 100vw)",
          background: "#0f172a", borderLeft: "1px solid #334155",
          zIndex: 201, display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid #1e293b", flexShrink: 0,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 12 }}>
            {asset?.original_filename || asset?.immich_id || "Asset metadata"}
          </div>
          <button
            onClick={onClose}
            aria-label="Close asset details"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {isLoading && (
          <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
            Loading asset metadata...
          </div>
        )}
        {isError && (
          <div style={{ padding: 32, textAlign: "center", color: "#fca5a5" }}>
            Could not load asset metadata.
          </div>
        )}
        {refreshMutation.isError && (
          <div style={{ padding: "10px 20px", color: "#fca5a5", background: "#7f1d1d30", fontSize: 12 }}>
            Could not refresh metadata from Immich.
          </div>
        )}
        {asset && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <AssetImagePreview
              asset={asset}
              imgError={imgError}
              onImageError={() => setImgError(true)}
            />

            <div style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Metadata
              </div>
              <MetaRow icon={<Calendar size={13} />} label="Date taken" value={asset.file_created_at ? formatDateTime(asset.file_created_at) : null} />
              <MetaRow icon={<MapPin size={13} />} label="Location" value={location || null} />
              <MetaRow icon={<Camera size={13} />} label="Camera" value={[asset.camera_make, asset.camera_model].filter(Boolean).join(" ") || null} />
              {asset.description && <MetaRow icon={<Tag size={13} />} label="Description" value={asset.description} />}
              <MetaRow
                icon={<Tag size={13} />}
                label="Current tags"
                value={
                  (asset.tags ?? []).length > 0 ? (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 }}>
                      {(asset.tags ?? []).map((tag) => (
                        <span key={tag} style={{ fontSize: 11, background: "#1e293b", border: "1px solid #334155", borderRadius: 5, padding: "2px 8px", color: "#94a3b8" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: "#64748b" }}>No tags</span>
                  )
                }
              />
              {(asset.people ?? []).length > 0 && (
                <MetaRow
                  icon={<UserRound size={13} />}
                  label="People"
                  value={<PeopleGrid asset={asset} />}
                />
              )}
              {(asset.album_ids ?? []).length > 0 && (
                <MetaRow icon={<Tag size={13} />} label="Albums" value={`${asset.album_ids!.length} album${asset.album_ids!.length !== 1 ? "s" : ""}`} />
              )}
              <MetaRow icon={<Tag size={13} />} label="MIME type" value={asset.mime_type ?? null} />
              <MetaRow icon={<Clock size={13} />} label="Synced at" value={asset.synced_at ? formatDateTime(asset.synced_at) : null} />
              <MetaRow
                icon={<Tag size={13} />}
                label="Immich ID"
                value={immichAssetUrl ? (
                  <a
                    href={immichAssetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      color: "#38bdf8",
                      fontFamily: "monospace",
                      fontSize: 11,
                      textDecoration: "none",
                    }}
                  >
                    {asset.immich_id}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b" }}>
                    {asset.immich_id}
                  </span>
                )}
              />
            </div>
          </div>
        )}
        <div style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          padding: "12px 20px",
          borderTop: "1px solid #1e293b",
          background: "#0f172a",
          flexShrink: 0,
        }}>
          <button
            onClick={() => setAiQueryOpen(true)}
            disabled={aiQueryOpen}
            aria-label="AI Query"
            title="Query AI using the current routing configuration"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: "#a855f718",
              border: "1px solid #a855f740",
              borderRadius: 6,
              cursor: "pointer",
              color: "#c084fc",
              padding: "8px 10px",
              fontSize: 12,
              opacity: aiQueryOpen ? 0.55 : 1,
            }}
          >
            <Sparkles size={13} />
            AI Query
          </button>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || aiQueryOpen}
            aria-label="Refresh metadata"
            title="Refresh metadata from Immich"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: "#0ea5e918",
              border: "1px solid #0ea5e940",
              borderRadius: 6,
              cursor: refreshMutation.isPending ? "wait" : "pointer",
              color: "#38bdf8",
              padding: "8px 10px",
              fontSize: 12,
              opacity: refreshMutation.isPending || aiQueryOpen ? 0.55 : 1,
            }}
          >
            <RefreshCw size={13} />
            {refreshMutation.isPending ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {aiQueryOpen && (
          <AssetAiQueryPanel
            assetId={assetId}
            assetName={asset?.original_filename || asset?.immich_id || "asset"}
            assetPreview={asset ? (
              <AiAssetPreview
                asset={asset}
                imgError={imgError}
                onImageError={() => setImgError(true)}
              />
            ) : null}
            onClose={() => setAiQueryOpen(false)}
          />
        )}
      </div>
    </>
  );
}
