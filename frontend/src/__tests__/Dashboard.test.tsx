import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

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
});
