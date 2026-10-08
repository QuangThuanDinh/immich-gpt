import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Assets from "../pages/Assets";

vi.mock("../services/api", () => ({
  getAssets: vi.fn(),
  getAsset: vi.fn(),
  getAssetCount: vi.fn(),
  refreshAssetMetadata: vi.fn(),
  startRoutingClassify: vi.fn(),
  getJob: vi.fn(),
  getRoutingPlanItems: vi.fn(),
  listRoutingNodes: vi.fn(),
  updateRoutingPlanItem: vi.fn(),
  approveRoutingPlanItems: vi.fn(),
  cancelJob: vi.fn(),
  rejectRoutingPlanItems: vi.fn(),
  deleteRoutingPlan: vi.fn(),
  getImmichSettings: vi.fn().mockResolvedValue({ immich_url: "http://immich.local" }),
  getThumbnailUrl: (assetId: string, size = "thumbnail") =>
    `/api/thumbnails/${assetId}?size=${size}`,
  getPersonThumbnailUrl: (assetId: string, personId: string) =>
    `/api/thumbnails/${assetId}/people/${personId}`,
}));

import {
  getAssets,
  getAssetCount,
  refreshAssetMetadata,
  startRoutingClassify,
  getJob,
  getRoutingPlanItems,
  listRoutingNodes,
  updateRoutingPlanItem,
  approveRoutingPlanItems,
  cancelJob,
  rejectRoutingPlanItems,
  deleteRoutingPlan,
} from "../services/api";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/assets"]}>
        <Assets />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Assets page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAssets).mockResolvedValue([
      {
        id: "asset-1",
        immich_id: "immich-1",
        original_filename: "photo.jpg",
        file_created_at: "2026-05-05T10:00:00Z",
        asset_type: "IMAGE",
        is_favorite: false,
        is_archived: false,
        is_external_library: false,
        created_at: "2026-05-05T10:00:00Z",
      },
    ]);
    vi.mocked(getAssetCount).mockResolvedValue({ count: 1 });
    vi.mocked(startRoutingClassify).mockResolvedValue({
      job_id: "job-1",
      plan_id: "plan-1",
      status: "queued",
    });
    vi.mocked(getJob).mockResolvedValue({
      id: "job-1",
      job_type: "routing_classification",
      status: "completed",
      progress_percent: 100,
      processed_count: 1,
      total_count: 1,
      success_count: 1,
      error_count: 0,
      created_at: "2026-05-05T10:00:00Z",
    });
    vi.mocked(getRoutingPlanItems).mockResolvedValue([{
      id: "item-1",
      plan_id: "plan-1",
      asset_id: "asset-1",
      primary_bucket_id: "route-1",
      primary_bucket_path: "People / Family",
      secondary_bucket_ids: [],
      disposition: "keep",
      confidence: 0.95,
      review_required: false,
      auto_apply: true,
      review_reasons: [],
      reason_codes: [],
      safety_flags: {},
      quality_flags: {},
      suggested_description: "Original AI description",
      suggested_caption: "Original caption",
      suggested_tags: ["family", "portrait"],
      suggested_location: { place_name: "Hanoi", latitude: 21, longitude: 105 },
      status: "pending",
    }]);
    vi.mocked(listRoutingNodes).mockResolvedValue([{
      id: "route-1",
      name: "Family",
      path: "People / Family",
      is_leaf: true,
      enabled: true,
      priority: 0,
      destination_type: "virtual",
      create_album_if_missing: false,
      auto_apply_enabled: true,
      auto_apply_threshold: 0.9,
      exclusive: true,
      allow_secondary: false,
      minimum_quality: "any",
      allow_blurry: true,
      allow_dark: true,
      allow_screenshot: true,
      allow_duplicate: true,
      suggest_description: true,
      suggest_tags: true,
      suggest_location: true,
      suggest_caption: true,
      write_description: true,
      write_tags: true,
      write_location: true,
      custom_prompt_enabled: false,
      positive_criteria: [],
      negative_criteria: [],
      privacy_rules: {},
      quality_rules: {},
      automation_rules: {},
      metadata_rules: {},
    }]);
    vi.mocked(updateRoutingPlanItem).mockImplementation(async (_planId, _itemId, update) => ({
      ...(await vi.mocked(getRoutingPlanItems)("plan-1"))[0],
      ...update,
    }));
    vi.mocked(approveRoutingPlanItems).mockResolvedValue({ approved: 1, applied: 1, failed: 0 });
    vi.mocked(cancelJob).mockResolvedValue({ cancelled: true });
    vi.mocked(rejectRoutingPlanItems).mockResolvedValue({ rejected: 1 });
    vi.mocked(deleteRoutingPlan).mockResolvedValue({ deleted: true });
    vi.mocked(refreshAssetMetadata).mockResolvedValue({
      id: "asset-1",
      immich_id: "immich-1",
      original_filename: "photo.jpg",
      asset_type: "IMAGE",
      is_favorite: false,
      is_archived: false,
      is_external_library: false,
      created_at: "2026-05-05T10:00:00Z",
    });
  });

  it("lazy-loads and asynchronously decodes grid thumbnails", async () => {
    renderPage();

    const image = await screen.findByRole("img", { name: "photo.jpg" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("requests 24 assets in the standard page width", async () => {
    renderPage();

    await waitFor(() => {
      expect(getAssets).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, page_size: 24 })
      );
    });
    const page = screen.getByTestId("assets-page");
    expect(page).toHaveStyle({ maxWidth: "1400px" });
    expect(page.style.margin).toBe("");
    expect(await screen.findByTestId("assets-grid")).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      gap: "12px",
    });
  });

  it("shows synced tags and people in the asset side pane", async () => {
    vi.mocked(getAssets).mockResolvedValue([{
      id: "asset-1",
      immich_id: "immich-1",
      original_filename: "photo.jpg",
      asset_type: "IMAGE",
      tags: ["ramen", "dining"],
      people: [{
        id: "person-1",
        name: "Kelly",
        is_hidden: false,
        is_favorite: false,
      }],
      is_favorite: false,
      is_archived: false,
      is_external_library: false,
      created_at: "2026-05-05T10:00:00Z",
    }]);
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));

    expect(document.body.style.overflow).toBe("hidden");
    expect(await screen.findByText("Current tags")).toBeInTheDocument();
    expect(screen.getByText("ramen")).toBeInTheDocument();
    expect(screen.getByText("dining")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Kelly")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Kelly" })).toHaveAttribute(
      "src",
      "/api/thumbnails/asset-1/people/person-1"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close asset details" }));
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
  });

  it("refreshes metadata for the selected asset", async () => {
    vi.mocked(refreshAssetMetadata).mockResolvedValue({
      id: "asset-1",
      immich_id: "immich-1",
      original_filename: "photo.jpg",
      asset_type: "IMAGE",
      tags: ["refreshed"],
      people: [{
        id: "person-1",
        name: "Minh Ha",
        is_hidden: false,
        is_favorite: false,
      }],
      is_favorite: false,
      is_archived: false,
      is_external_library: false,
      synced_at: "2026-10-07T12:00:00Z",
      created_at: "2026-05-05T10:00:00Z",
    });
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh metadata" }));

    await waitFor(() => {
      expect(refreshAssetMetadata).toHaveBeenCalledWith("asset-1");
    });
    expect(await screen.findByText("refreshed")).toBeInTheDocument();
    expect(screen.getByText("Minh Ha")).toBeInTheDocument();
  });

  it("queries one asset in review-only mode and saves edits before approval", async () => {
    vi.mocked(getAssets).mockResolvedValue([{
      id: "asset-1",
      immich_id: "immich-1",
      original_filename: "photo.jpg",
      asset_type: "IMAGE",
      people: [{
        id: "person-1",
        name: "Kelly",
        is_hidden: false,
        is_favorite: false,
      }],
      is_favorite: false,
      is_archived: false,
      is_external_library: false,
      created_at: "2026-05-05T10:00:00Z",
    }]);
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    const aiQueryButton = screen.getByRole("button", { name: "AI Query" });
    const refreshButton = screen.getByRole("button", { name: "Refresh metadata" });
    expect(
      aiQueryButton.compareDocumentPosition(refreshButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(aiQueryButton);

    const aiResult = await screen.findByRole("region", { name: "AI Query result" });
    expect(aiResult).toBeInTheDocument();
    expect(aiResult).toHaveStyle({
      position: "fixed",
      right: "0px",
    });
    expect(within(aiResult).getByRole("img", { name: "photo.jpg" })).toBeInTheDocument();
    expect(within(aiResult).getByText("Kelly")).toBeInTheDocument();
    expect(within(aiResult).getByText("AI Query for photo.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to asset metadata" })).toBeInTheDocument();
    const approveButton = screen.getByRole("button", { name: "Approve" });
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(approveButton.querySelector("svg")).toBeInTheDocument();
    expect(rejectButton.querySelector("svg")).toBeInTheDocument();
    expect(
      approveButton.compareDocumentPosition(rejectButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await waitFor(() => {
      expect(startRoutingClassify).toHaveBeenCalledWith({
        asset_ids: ["asset-1"],
        force: true,
        review_only: true,
      });
    });

    expect(await screen.findByDisplayValue("Original AI description")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Edited description" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), {
      target: { value: "family, edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(updateRoutingPlanItem).toHaveBeenCalledWith(
        "plan-1",
        "item-1",
        expect.objectContaining({
          primary_bucket_id: "route-1",
          suggested_description: "Edited description",
          suggested_tags: ["family", "edited"],
        })
      );
      expect(approveRoutingPlanItems).toHaveBeenCalledWith(
        "plan-1",
        { item_ids: ["item-1"] }
      );
      expect(refreshAssetMetadata).toHaveBeenCalledWith("asset-1");
      expect(deleteRoutingPlan).toHaveBeenCalledWith("plan-1");
    });
  });

  it("shows AI loading over the current metadata pane", async () => {
    vi.mocked(getJob).mockResolvedValue({
      id: "job-1",
      job_type: "routing_classification",
      status: "classifying_ai",
      current_step: "Analyzing photo",
      progress_percent: 50,
      processed_count: 0,
      total_count: 1,
      success_count: 0,
      error_count: 0,
      created_at: "2026-05-05T10:00:00Z",
    });
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "AI Query" }));

    expect(await screen.findByRole("status", { name: "AI Query loading" })).toHaveTextContent(
      "Analyzing photo"
    );
    expect(screen.getByTestId("ai-query-spinner")).toHaveStyle({
      animation: "ai-query-spin 0.8s linear infinite",
    });
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI Query result" })).not.toBeInTheDocument();
  });

  it("cancels a running AI query before deleting its temporary plan", async () => {
    const runningJob = {
      id: "job-1",
      job_type: "routing_classification",
      status: "classifying_ai",
      current_step: "Analyzing photo",
      progress_percent: 50,
      processed_count: 0,
      total_count: 1,
      success_count: 0,
      error_count: 0,
      created_at: "2026-05-05T10:00:00Z",
    };
    vi.mocked(getJob)
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValue({
        ...runningJob,
        status: "cancelled",
      });
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "AI Query" }));
    await screen.findByRole("status", { name: "AI Query loading" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(cancelJob).toHaveBeenCalledWith("job-1");
      expect(deleteRoutingPlan).toHaveBeenCalledWith("plan-1");
    });
  });

  it("records a rejected AI result", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "AI Query" }));
    await screen.findByDisplayValue("Original AI description");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(updateRoutingPlanItem).toHaveBeenCalled();
      expect(rejectRoutingPlanItems).toHaveBeenCalledWith(
        "plan-1",
        { item_ids: ["item-1"] }
      );
      expect(deleteRoutingPlan).toHaveBeenCalledWith("plan-1");
    });
    expect(approveRoutingPlanItems).not.toHaveBeenCalled();
  });

  it("deletes a completed AI query when returning to asset metadata", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "AI Query" }));
    await screen.findByDisplayValue("Original AI description");
    fireEvent.click(screen.getByRole("button", { name: "Back to asset metadata" }));

    await waitFor(() => {
      expect(deleteRoutingPlan).toHaveBeenCalledWith("plan-1");
      expect(screen.queryByRole("region", { name: "AI Query result" })).not.toBeInTheDocument();
    });
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it("keeps the AI result open when Immich writeback fails", async () => {
    vi.mocked(approveRoutingPlanItems).mockResolvedValue({
      approved: 1,
      applied: 0,
      failed: 1,
    });
    renderPage();

    fireEvent.click(await screen.findByText("photo.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "AI Query" }));
    await screen.findByDisplayValue("Original AI description");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Immich rejected one or more metadata updates"
    );
    expect(screen.getByRole("region", { name: "AI Query result" })).toBeInTheDocument();
  });
});
