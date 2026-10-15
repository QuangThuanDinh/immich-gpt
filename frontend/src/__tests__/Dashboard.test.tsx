import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import dashboardStyles from "../pages/Dashboard.module.css";

const mocks = vi.hoisted(() => ({
  getImmichSettings: vi.fn(),
  getAssetCount: vi.fn(),
  getJobs: vi.fn(),
  getAlbums: vi.fn(),
  startSyncJob: vi.fn(),
  startRoutingClassify: vi.fn(),
  clearTerminalJobs: vi.fn(),
  listRoutingPlans: vi.fn(),
  listRoutingNodes: vi.fn(),
}));

vi.mock("../services/api", () => ({
  getImmichSettings: mocks.getImmichSettings,
  getAssetCount: mocks.getAssetCount,
  getJobs: mocks.getJobs,
  getAlbums: mocks.getAlbums,
  startSyncJob: mocks.startSyncJob,
  startRoutingClassify: mocks.startRoutingClassify,
  clearTerminalJobs: mocks.clearTerminalJobs,
  listRoutingPlans: mocks.listRoutingPlans,
  listRoutingNodes: mocks.listRoutingNodes,
}));

import Dashboard from "../pages/Dashboard";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderDashboard() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getImmichSettings.mockResolvedValue({ immich_url: "", connected: false });
  mocks.getAssetCount.mockResolvedValue({ count: 0 });
  mocks.getJobs.mockResolvedValue([]);
  mocks.getAlbums.mockResolvedValue([]);
  mocks.listRoutingPlans.mockResolvedValue([]);
  mocks.listRoutingNodes.mockResolvedValue([]);
  mocks.startSyncJob.mockResolvedValue({ job_id: "sync-job", status: "queued" });
  mocks.startRoutingClassify.mockResolvedValue({ job_id: "route-job", plan_id: "plan", status: "queued" });
});

describe("Dashboard workflow", () => {
  it("links dashboard stat cards to their related pages", async () => {
    mocks.getAssetCount.mockResolvedValue({ count: 12 });
    mocks.listRoutingNodes.mockResolvedValue([
      { id: "leaf", name: "Leaf", enabled: true, is_leaf: true },
    ]);
    mocks.listRoutingPlans.mockResolvedValue([{
      id: "review-plan",
      job_id: "finished-route",
      status: "ready",
      item_count: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);

    renderDashboard();

    expect(await screen.findByRole("link", { name: /Synced Assets 12/i }))
      .toHaveAttribute("href", "/assets");
    expect(screen.getByRole("link", { name: /Routing Leaves 1/i }))
      .toHaveAttribute("href", "/routing");
    expect(screen.getByRole("link", { name: /Pending Plan Items 3/i }))
      .toHaveAttribute("href", "/routing/plans?plan=review-plan");
  });

  it("sends sync+route to backend without starting routing immediately", async () => {
    renderDashboard();

    await screen.findByText("Run Workflow");
    const syncRouteButtons = screen.getAllByRole("button", { name: /sync \+ route/i });
    fireEvent.click(syncRouteButtons[syncRouteButtons.length - 1]);

    await waitFor(() => {
      expect(mocks.startSyncJob).toHaveBeenCalledWith({
        scope: "all",
        album_ids: undefined,
        run_routing_after: true,
        quick_sync: true,
        full_sync: false,
      });
    });
    expect(mocks.startRoutingClassify).not.toHaveBeenCalled();
  });

  it("can explicitly start a full sync", async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Sync Only" }));
    fireEvent.click(screen.getByRole("button", { name: "Quick Sync options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Full Sync/i }));

    await waitFor(() => {
      expect(mocks.startSyncJob).toHaveBeenCalledWith({
        scope: "all",
        album_ids: undefined,
        run_routing_after: false,
        quick_sync: false,
        full_sync: true,
      });
    });
  });

  it("starts Quick Sync from the primary sync action", async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Sync Only" }));
    fireEvent.click(screen.getByRole("button", { name: "Quick Sync" }));

    await waitFor(() => {
      expect(mocks.startSyncJob).toHaveBeenCalledWith({
        scope: "all",
        album_ids: undefined,
        run_routing_after: false,
        quick_sync: true,
        full_sync: false,
      });
    });
  });

  it("offers Normal Sync in the sync menu", async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Sync Only" }));
    fireEvent.click(screen.getByRole("button", { name: "Quick Sync options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Normal Sync/i }));

    await waitFor(() => {
      expect(mocks.startSyncJob).toHaveBeenCalledWith({
        scope: "all",
        album_ids: undefined,
        run_routing_after: false,
        quick_sync: false,
        full_sync: false,
      });
    });
  });

  it("can reprocess all assets from the routing workflow", async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: /Route Only/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run Routing options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Reprocess all assets/i }));

    await waitFor(() => {
      expect(mocks.startRoutingClassify).toHaveBeenCalledWith({ force: true });
    });
  });

  it("links an in-progress routing plan directly to review", async () => {
    mocks.getJobs.mockResolvedValue([{
      id: "route-job",
      job_type: "routing_classification",
      status: "classifying_ai",
      progress_percent: 25,
      processed_count: 1,
      total_count: 4,
      success_count: 1,
      error_count: 0,
      created_at: new Date().toISOString(),
    }]);
    mocks.listRoutingPlans.mockResolvedValue([{
      id: "plan/one",
      job_id: "route-job",
      status: "draft",
      item_count: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);

    renderDashboard();

    const reviewLink = await screen.findByRole("link", { name: /Pending Plan Items 1/i });
    expect(reviewLink).toHaveAttribute("href", "/routing/plans?plan=plan%2Fone");
    expect(reviewLink).toHaveClass(dashboardStyles.statCardWarning);
    expect(screen.queryByRole("link", { name: /Review 1 pending item/i })).not.toBeInTheDocument();
  });

  it("shows mixed plans that still contain items awaiting approval", async () => {
    mocks.listRoutingPlans.mockResolvedValue([
      {
        id: "mixed-plan",
        job_id: "finished-route",
        status: "partially_applied",
        item_count: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "older-plan",
        job_id: "older-route",
        status: "ready",
        item_count: 4,
        created_at: new Date(Date.now() - 60_000).toISOString(),
        updated_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);

    renderDashboard();

    expect(await screen.findByRole("link", { name: /Pending Plan Items 3/i }))
      .toHaveAttribute("href", "/routing/plans?plan=mixed-plan");
    expect(screen.queryByRole("link", { name: /Review \d+ pending items/i })).not.toBeInTheDocument();
  });
});
