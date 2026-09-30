import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mocks = vi.hoisted(() => ({
  treeMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  dupMock: vi.fn(),
  examplesMock: vi.fn(),
  addExampleMock: vi.fn(),
  deleteExampleMock: vi.fn(),
  promptPreviewMock: vi.fn(),
  classifyMock: vi.fn(),
  plansMock: vi.fn(),
  planSummaryMock: vi.fn(),
  planItemsMock: vi.fn(),
  updateItemMock: vi.fn(),
  nodesMock: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
  applyMock: vi.fn(),
}));

vi.mock("../services/api", () => ({
  getRoutingTree: mocks.treeMock,
  createRoutingNode: mocks.createMock,
  updateRoutingNode: mocks.updateMock,
  deleteRoutingNode: mocks.deleteMock,
  duplicateRoutingNode: mocks.dupMock,
  moveRoutingNode: vi.fn(),
  listRoutingNodes: mocks.nodesMock,
  listRoutingExamples: mocks.examplesMock,
  addRoutingExample: mocks.addExampleMock,
  deleteRoutingExample: mocks.deleteExampleMock,
  getRoutingPromptPreview: mocks.promptPreviewMock,
  startRoutingClassify: mocks.classifyMock,
  listRoutingPlans: mocks.plansMock,
  getRoutingPlanSummary: mocks.planSummaryMock,
  getRoutingPlanItems: mocks.planItemsMock,
  updateRoutingPlanItem: mocks.updateItemMock,
  approveRoutingPlanItems: mocks.approveMock,
  rejectRoutingPlanItems: mocks.rejectMock,
  moveRoutingPlanItems: vi.fn(),
  applyRoutingPlan: mocks.applyMock,
  getRoutingPlan: vi.fn(),
  getThumbnailUrl: (assetId: string) => `/api/thumbnails/${assetId}`,
}));

const {
  treeMock, createMock, examplesMock, promptPreviewMock,
  classifyMock, plansMock, planSummaryMock, planItemsMock, updateItemMock,
  nodesMock, approveMock, rejectMock,
} = mocks;

import Routing from "../pages/Routing";
import RoutingPlans from "../pages/RoutingPlans";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  treeMock.mockReset();
  createMock.mockReset();
  examplesMock.mockReset();
  promptPreviewMock.mockReset();
  plansMock.mockReset();
  planSummaryMock.mockReset();
  planItemsMock.mockReset();
  updateItemMock.mockReset();
  nodesMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  classifyMock.mockReset();
  classifyMock.mockResolvedValue({ job_id: "job-1", plan_id: "plan-1", status: "queued" });
  planItemsMock.mockResolvedValue([]);
  nodesMock.mockResolvedValue([]);
  planSummaryMock.mockResolvedValue({
    plan_id: "plan-1",
    total: 0,
    groups: {
      auto_applied: [],
      ready_to_approve: [],
      needs_review: [],
      trash_candidates: [],
      rejected: [],
      failed: [],
    },
  });
  vi.stubGlobal("alert", vi.fn());
});

describe("Routing tree page", () => {
  it("renders nested nodes", async () => {
    treeMock.mockResolvedValue({
      nodes: [
        {
          id: "n1", parent_id: null, name: "Personal", path: "Personal",
          is_leaf: false, enabled: true, priority: 100,
          destination_type: "virtual", create_album_if_missing: true,
          auto_apply_enabled: false, auto_apply_threshold: 0.95, review_below_threshold: 0.85,
          exclusive: false, allow_secondary: true,
          minimum_quality: "any", allow_blurry: true, allow_dark: true,
          allow_screenshot: true, allow_duplicate: true,
          suggest_description: true, suggest_tags: true, suggest_location: false, suggest_caption: false,
          write_description: true, write_tags: true, write_location: false,
          custom_prompt_enabled: false,
          positive_criteria: [], negative_criteria: [],
          privacy_rules: {}, quality_rules: {}, automation_rules: {}, metadata_rules: {},
          children: [
            {
              id: "n2", parent_id: "n1", name: "Lake House", path: "Personal/Lake House",
              is_leaf: true, enabled: true, priority: 100,
              destination_type: "virtual", create_album_if_missing: true,
              auto_apply_enabled: false, auto_apply_threshold: 0.95, review_below_threshold: 0.85,
              exclusive: false, allow_secondary: true,
              minimum_quality: "any", allow_blurry: true, allow_dark: true,
              allow_screenshot: true, allow_duplicate: true,
              suggest_description: true, suggest_tags: true, suggest_location: false, suggest_caption: false,
              write_description: true, write_tags: true, write_location: false,
              custom_prompt_enabled: false,
              positive_criteria: [], negative_criteria: [],
              privacy_rules: {}, quality_rules: {}, automation_rules: {}, metadata_rules: {},
              children: [],
            },
          ],
        },
      ],
    });

    render(<Wrapper><Routing /></Wrapper>);
    await waitFor(() => expect(screen.getAllByText("Personal").length).toBeGreaterThan(0));
    // Children render only after the parent is expanded; click chevron toggle.
    expect(screen.getAllByText("Personal").length).toBeGreaterThan(0);
  });

  it("creates a new root node via the inline form", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    createMock.mockResolvedValue({ id: "new-1" });

    render(<Wrapper><Routing /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/Add root/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Add root/i));
    const input = await screen.findByPlaceholderText("Name");
    fireEvent.change(input, { target: { value: "Family" } });
    const createBtn = await screen.findByRole("button", { name: "Create" });
    fireEvent.click(createBtn);
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const firstCallArg = createMock.mock.calls[0]?.[0];
    expect(firstCallArg).toEqual(
      expect.objectContaining({ name: "Family", parent_id: null, is_leaf: true })
    );
  });

  it("opens the leaf editor when a node is selected", async () => {
    const node = {
      id: "leaf-1", parent_id: null, name: "Lake House", path: "Lake House",
      is_leaf: true, enabled: true, priority: 100,
      destination_type: "virtual", create_album_if_missing: true,
      auto_apply_enabled: false, auto_apply_threshold: 0.95, review_below_threshold: 0.85,
      exclusive: false, allow_secondary: true,
      minimum_quality: "any", allow_blurry: true, allow_dark: true,
      allow_screenshot: true, allow_duplicate: true,
      suggest_description: true, suggest_tags: true, suggest_location: false, suggest_caption: false,
      write_description: true, write_tags: true, write_location: false,
      custom_prompt_enabled: false,
      positive_criteria: ["sharp image"], negative_criteria: [],
      privacy_rules: {}, quality_rules: {}, automation_rules: {}, metadata_rules: {},
      children: [],
    };
    treeMock.mockResolvedValue({ nodes: [node] });
    examplesMock.mockResolvedValue([]);
    promptPreviewMock.mockResolvedValue({ bucket_id: "n1", path: "Lake House", compiled_prompt: "X" });

    render(<Wrapper><Routing /></Wrapper>);
    await waitFor(() => expect(screen.getAllByText("Lake House").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Lake House")[0]);
    await waitFor(() => expect(screen.getByText("Matching")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Matching"));
    await waitFor(() => expect(screen.getByText("sharp image")).toBeInTheDocument());
  });

  it("can reprocess all assets from the routing menu", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByRole("button", { name: "Run routing options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Reprocess all assets/i }));

    await waitFor(() => expect(classifyMock).toHaveBeenCalledWith({ force: true }));
  });
});

describe("Routing plans page", () => {
  it("renders empty state when no plans", async () => {
    plansMock.mockResolvedValue([]);
    render(<Wrapper><RoutingPlans /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/No plans yet/i)).toBeInTheDocument());
  });

  it("runs only new assets from the primary plan action", async () => {
    plansMock.mockResolvedValue([]);
    render(<Wrapper><RoutingPlans /></Wrapper>);

    fireEvent.click(await screen.findByRole("button", { name: "Run new plan" }));

    await waitFor(() => expect(classifyMock).toHaveBeenCalledWith({ force: false }));
  });

  it("shows plan summary groups when a plan is selected", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: "j1", status: "ready", item_count: 5,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 5,
      writeback: {
        write_description: 5,
        write_tags: 3,
        move_to_album: 3,
        move_to_trash: 0,
      },
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "Personal/Lake", bucket_id: "b1", count: 3, item_ids: ["i1","i2","i3"] }],
        needs_review: [{ path: "Family/Kids", bucket_id: "b2", count: 2, item_ids: ["i4","i5"] }],
        trash_candidates: [],
        rejected: [],
        failed: [],
      },
    });
    render(<Wrapper><RoutingPlans /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/ready/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/ready/i));
    await waitFor(() => expect(screen.getByText("Ready to approve")).toBeInTheDocument());
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("Personal/Lake")).toBeInTheDocument();
    expect(screen.getByText("Family/Kids")).toBeInTheDocument();
    expect(screen.getByText("Write descriptions: 5 items")).toBeInTheDocument();
    expect(screen.getByText("Write tags: 3 items")).toBeInTheDocument();
    expect(screen.getByText("Move to albums: 3 items")).toBeInTheDocument();
    expect(screen.queryByText(/Move to trash:/)).not.toBeInTheDocument();
  });

  it("approves a group via the Approve All button", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "X", bucket_id: "b1", count: 1, item_ids: ["i1"] }],
        needs_review: [],
        trash_candidates: [],
        rejected: [],
        failed: [],
      },
    });
    approveMock.mockResolvedValue({ approved: 1 });
    render(<Wrapper><RoutingPlans /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/ready/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/ready/i));
    await waitFor(() => expect(screen.getByText("Approve All")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve All"));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("p1", { item_ids: ["i1"] }));
  });

  it("rejects a group via the Reject All button", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 2,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 2,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "X", bucket_id: "b1", count: 2, item_ids: ["i1", "i2"] }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    rejectMock.mockResolvedValue({ rejected: 1 });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Reject All" }));

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith(
      "p1",
      { item_ids: ["i1", "i2"] }
    ));
  });

  it("expands a group, saves edits, and approves one item", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "Personal", bucket_id: "b1", count: 1, item_ids: ["i1"] }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    const item = {
      id: "i1", plan_id: "p1", asset_id: "a1",
      primary_bucket_id: "b1", primary_bucket_path: "Personal",
      secondary_bucket_ids: [], disposition: "keep" as const,
      confidence: 0.9, review_required: false, auto_apply: false,
      review_reasons: [], reason_codes: [], safety_flags: {}, quality_flags: {},
      suggested_description: "Original", suggested_tags: ["family"],
      suggested_location: { place_name: "Hanoi" }, suggested_caption: "Caption",
      status: "pending" as const, error_message: null,
    };
    planItemsMock.mockResolvedValue([item]);
    updateItemMock.mockResolvedValue({ ...item, suggested_description: "Edited" });
    approveMock.mockResolvedValue({ approved: 1 });
    nodesMock.mockResolvedValue([{
      id: "b1", name: "Personal", path: "Personal", parent_id: null,
      is_leaf: true, enabled: true, destination_type: "immich_album",
    }]);

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));

    const description = await screen.findByDisplayValue("Original");
    fireEvent.change(description, { target: { value: "Edited" } });
    fireEvent.blur(description);
    await waitFor(() => expect(updateItemMock).toHaveBeenCalledWith(
      "p1",
      "i1",
      expect.objectContaining({ suggested_description: "Edited" })
    ));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("p1", { item_ids: ["i1"] }));
  });

  it("rejects one pending item", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [],
        needs_review: [{ path: "Personal", bucket_id: "b1", count: 1, item_ids: ["i1"] }],
        ready_to_approve: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    planItemsMock.mockResolvedValue([{
      id: "i1", plan_id: "p1", asset_id: "a1",
      primary_bucket_id: "b1", primary_bucket_path: "Personal",
      secondary_bucket_ids: [], disposition: "review", confidence: 0.7,
      review_required: true, auto_apply: false, review_reasons: [],
      reason_codes: [], safety_flags: {}, quality_flags: {},
      suggested_description: null, suggested_tags: [],
      suggested_location: null, suggested_caption: null,
      status: "pending", error_message: null,
    }]);
    updateItemMock.mockResolvedValue({});
    rejectMock.mockResolvedValue({ rejected: 1 });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith("p1", { item_ids: ["i1"] }));
  });

  it("scopes page actions to pending items on the visible page", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 2,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 2,
      groups: {
        auto_applied: [],
        ready_to_approve: [{
          path: "Personal", bucket_id: "b1", count: 2,
          item_ids: ["pending", "approved"],
        }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    const baseItem = {
      plan_id: "p1", asset_id: "a1", primary_bucket_id: "b1",
      primary_bucket_path: "Personal", secondary_bucket_ids: [],
      disposition: "keep", confidence: 0.9, review_required: false,
      auto_apply: false, review_reasons: [], reason_codes: [],
      safety_flags: {}, quality_flags: {}, suggested_description: null,
      suggested_tags: [], suggested_location: null, suggested_caption: null,
      error_message: null,
    };
    planItemsMock.mockResolvedValue([
      { ...baseItem, id: "pending", status: "pending" },
      { ...baseItem, id: "approved", status: "approved" },
    ]);
    approveMock.mockResolvedValue({ approved: 1 });
    rejectMock.mockResolvedValue({ rejected: 1 });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));
    const approvePage = await screen.findByRole("button", { name: "Approve This Page" });
    await waitFor(() => expect(approvePage).toBeEnabled());
    fireEvent.click(approvePage);
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(
      "p1",
      { item_ids: ["pending"] }
    ));

    const rejectPage = screen.getByRole("button", { name: "Reject This Page" });
    await waitFor(() => expect(rejectPage).toBeEnabled());
    fireEvent.click(rejectPage);
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith(
      "p1",
      { item_ids: ["pending"] }
    ));
  });

  it("renders reviewed items as read-only when revisiting a plan", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "Personal", bucket_id: "b1", count: 1, item_ids: ["i1"] }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    planItemsMock.mockResolvedValue([{
      id: "i1", plan_id: "p1", asset_id: "a1",
      primary_bucket_id: "b1", primary_bucket_path: "Personal",
      secondary_bucket_ids: [], disposition: "keep", confidence: 0.9,
      review_required: false, auto_apply: false, review_reasons: [],
      reason_codes: [], safety_flags: {}, quality_flags: {},
      suggested_description: "Approved description", suggested_tags: ["family"],
      suggested_location: null, suggested_caption: null,
      status: "approved", error_message: null,
    }]);

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));

    expect(await screen.findByText("Approved description")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Approved description")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("uses the page size supplied by the backend", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 101,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 101, page_size: 25,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "Personal", bucket_id: "b1", count: 101, item_ids: [] }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));

    expect(await screen.findByText("Page 1 of 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(planItemsMock).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({ page: 2, page_size: 25 })
    ));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(planItemsMock).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({ page: 1, page_size: 25 })
    ));
  });

  it("keeps only one plan section expanded at a time", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 2,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 2,
      groups: {
        auto_applied: [],
        ready_to_approve: [
          { path: "Personal", bucket_id: "b1", count: 1, item_ids: ["i1"] },
          { path: "Work", bucket_id: "b2", count: 1, item_ids: ["i2"] },
        ],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));
    expect(screen.getByRole("button", { name: "Collapse Personal" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Work" }));
    expect(screen.getByRole("button", { name: "Collapse Work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Personal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse Personal" })).not.toBeInTheDocument();
  });

  it("shows a spinner while an individual action is processing", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "Personal", bucket_id: "b1", count: 1, item_ids: ["i1"] }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    planItemsMock.mockResolvedValue([{
      id: "i1", plan_id: "p1", asset_id: "a1",
      primary_bucket_id: "b1", primary_bucket_path: "Personal",
      secondary_bucket_ids: [], disposition: "keep", confidence: 0.9,
      review_required: false, auto_apply: false, review_reasons: [],
      reason_codes: [], safety_flags: {}, quality_flags: {},
      suggested_description: null, suggested_tags: [],
      suggested_location: null, suggested_caption: null,
      status: "pending", error_message: null,
    }]);
    updateItemMock.mockResolvedValue({});
    const action = deferred<{ approved: number }>();
    approveMock.mockReturnValueOnce(action.promise);

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    const processingButton = await screen.findByRole("button", { name: "Processing approval" });
    expect(processingButton).toBeDisabled();
    expect(processingButton.querySelector("svg")).toBeInTheDocument();
    action.resolve({ approved: 1 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Processing approval" })).not.toBeInTheDocument());
  });

  it("shows completed and total progress for batched group actions", async () => {
    const itemIds = Array.from({ length: 11 }, (_, index) => `i${index + 1}`);
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 11,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 11,
      groups: {
        auto_applied: [],
        ready_to_approve: [{ path: "Personal", bucket_id: "b1", count: 11, item_ids: itemIds }],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    const firstBatch = deferred<{ approved: number }>();
    const secondBatch = deferred<{ approved: number }>();
    approveMock
      .mockReturnValueOnce(firstBatch.promise)
      .mockReturnValueOnce(secondBatch.promise);

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Approve All" }));

    expect(await screen.findByText("Processing 0/11")).toBeInTheDocument();
    expect(approveMock).toHaveBeenNthCalledWith(1, "p1", { item_ids: itemIds.slice(0, 10) });

    firstBatch.resolve({ approved: 10 });
    expect(await screen.findByText("Processing 10/11")).toBeInTheDocument();
    expect(approveMock).toHaveBeenNthCalledWith(2, "p1", { item_ids: itemIds.slice(10) });

    secondBatch.resolve({ approved: 1 });
    await waitFor(() => expect(screen.queryByText(/Processing \d+\/11/)).not.toBeInTheDocument());
  });
});
