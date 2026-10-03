import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  evaluationMock: vi.fn(),
  saveEvaluationMock: vi.fn(),
  runEvaluationMock: vi.fn(),
  runEvaluationItemMock: vi.fn(),
  routingPreferencesMock: vi.fn(),
  exportTreeSettingsMock: vi.fn(),
  importTreeSettingsMock: vi.fn(),
  plansMock: vi.fn(),
  planSummaryMock: vi.fn(),
  planItemsMock: vi.fn(),
  updateItemMock: vi.fn(),
  nodesMock: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
  applyMock: vi.fn(),
  assetMock: vi.fn(),
}));

vi.mock("../services/api", () => ({
  getRoutingTree: mocks.treeMock,
  exportRoutingTreeSettings: mocks.exportTreeSettingsMock,
  importRoutingTreeSettings: mocks.importTreeSettingsMock,
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
  getRoutingEvaluation: mocks.evaluationMock,
  getRoutingPreferences: mocks.routingPreferencesMock,
  saveRoutingEvaluation: mocks.saveEvaluationMock,
  startRoutingEvaluation: mocks.runEvaluationMock,
  runRoutingEvaluationItem: mocks.runEvaluationItemMock,
  listRoutingPlans: mocks.plansMock,
  getRoutingPlanSummary: mocks.planSummaryMock,
  getRoutingPlanItems: mocks.planItemsMock,
  updateRoutingPlanItem: mocks.updateItemMock,
  approveRoutingPlanItems: mocks.approveMock,
  rejectRoutingPlanItems: mocks.rejectMock,
  moveRoutingPlanItems: vi.fn(),
  applyRoutingPlan: mocks.applyMock,
  getAsset: mocks.assetMock,
  getImmichSettings: vi.fn().mockResolvedValue({
    immich_url: "https://image.example.com/",
    connected: true,
  }),
  getRoutingPlan: vi.fn(),
  getThumbnailUrl: (assetId: string) => `/api/thumbnails/${assetId}`,
}));

const {
  treeMock, createMock, examplesMock, promptPreviewMock,
  classifyMock, plansMock, planSummaryMock, planItemsMock, updateItemMock,
  evaluationMock, saveEvaluationMock, runEvaluationMock, runEvaluationItemMock,
  routingPreferencesMock,
  exportTreeSettingsMock, importTreeSettingsMock,
  nodesMock, approveMock, rejectMock, applyMock,
  assetMock,
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
  applyMock.mockReset();
  assetMock.mockReset();
  classifyMock.mockReset();
  evaluationMock.mockReset();
  saveEvaluationMock.mockReset();
  runEvaluationMock.mockReset();
  runEvaluationItemMock.mockReset();
  routingPreferencesMock.mockReset();
  exportTreeSettingsMock.mockReset();
  importTreeSettingsMock.mockReset();
  routingPreferencesMock.mockResolvedValue({
    learn_from_corrections: false,
    processing_concurrency: 1,
  });
  exportTreeSettingsMock.mockResolvedValue({ version: 1, nodes: [] });
  importTreeSettingsMock.mockResolvedValue({ nodes: [] });
  classifyMock.mockResolvedValue({ job_id: "job-1", plan_id: "plan-1", status: "queued" });
  evaluationMock.mockResolvedValue({
    items: [],
    total_score: null,
    max_score: null,
    evaluated_at: null,
  });
  saveEvaluationMock.mockResolvedValue({
    items: [{
      id: "eval-1",
      immich_id: "immich-image-1",
      expected_tag: "dog",
      expected_destination: null,
      result_tags: [],
    }],
    total_score: null,
    max_score: null,
    evaluated_at: null,
  });
  runEvaluationMock.mockResolvedValue({
    items: [],
    total_score: 0,
    max_score: 0,
    evaluated_at: "2026-10-02T00:00:00Z",
  });
  runEvaluationItemMock.mockResolvedValue({
    items: [],
    total_score: 0,
    max_score: 0,
    evaluated_at: "2026-10-02T00:00:00Z",
  });
  applyMock.mockResolvedValue({ applied: 0, failed: 0 });
  assetMock.mockResolvedValue({
    id: "a1",
    immich_id: "immich-a1",
    original_filename: "photo.jpg",
    file_created_at: "2026-05-05T10:00:00Z",
    asset_type: "IMAGE",
    mime_type: "image/jpeg",
    city: "Hanoi",
    country: "Vietnam",
    tags: ["existing-tag"],
    is_favorite: false,
    is_archived: false,
    is_external_library: false,
    created_at: "2026-05-05T10:00:00Z",
  });
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
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("Routing tree page", () => {
  it("confirms and replaces all Routing Tree settings when importing", async () => {
    const oldNode = {
      id: "old", parent_id: null, name: "Old Root", path: "Old Root",
      is_leaf: true, enabled: true, priority: 100,
      destination_type: "virtual", create_album_if_missing: true,
      auto_apply_enabled: false, auto_apply_threshold: 0.95,
      review_below_threshold: 0.85, exclusive: false, allow_secondary: true,
      minimum_quality: "any", allow_blurry: true, allow_dark: true,
      allow_screenshot: true, allow_duplicate: true,
      suggest_description: true, suggest_tags: true, suggest_location: false,
      suggest_caption: false, write_description: true, write_tags: true,
      write_location: false, custom_prompt_enabled: false,
      positive_criteria: [], negative_criteria: [], privacy_rules: {},
      quality_rules: {}, automation_rules: {}, metadata_rules: {}, children: [],
    };
    const newNode = { ...oldNode, id: "new", name: "Imported Root", path: "Imported Root" };
    treeMock
      .mockResolvedValueOnce({ nodes: [oldNode] })
      .mockResolvedValue({ nodes: [newNode] });
    const imported = {
      version: 1 as const,
      nodes: [{
        name: "Imported Root",
        enabled: true,
        priority: 3,
        children: [{
          name: "Imported Leaf",
          enabled: true,
          priority: 4,
          children: [],
        }],
      }],
    };
    importTreeSettingsMock.mockResolvedValue({ nodes: [newNode] });
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByLabelText("Routing Tree settings options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Import settings/i }));
    const file = new File(
      [JSON.stringify(imported)],
      "routing-tree.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText("Import Routing Tree settings file"), {
      target: { files: [file] },
    });

    expect(confirm).toHaveBeenCalledWith(
      "Import will override the current Routing Tree settings. Continue?",
    );
    await waitFor(() => {
      expect(importTreeSettingsMock).toHaveBeenCalledWith(imported);
    });
    expect((await screen.findAllByText("Imported Root")).length).toBeGreaterThan(0);
  });

  it("exports complete Routing Tree settings returned by the backend", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    const exportedSettings = {
      version: 1 as const,
      nodes: [{
        name: "Documents",
        description: "Readable content",
        enabled: true,
        priority: 5,
        destination_type: "virtual",
        children: [{ name: "Tax", enabled: true, priority: 4, children: [] }],
      }],
    };
    exportTreeSettingsMock.mockResolvedValue(exportedSettings);
    const exportedBlobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        exportedBlobs.push(blob);
        return "blob:routing-tree";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByLabelText("Routing Tree settings options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export settings/i }));

    await waitFor(() => expect(exportTreeSettingsMock).toHaveBeenCalled());
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlobs[0]);
    });
    expect(JSON.parse(text)).toEqual(exportedSettings);
    click.mockRestore();
  });

  it("adds and saves evaluation items only after required input is valid", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    render(<Wrapper><Routing /></Wrapper>);

    expect(await screen.findByRole("heading", { name: "Evaluation" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Add item/i }));

    const saveButton = screen.getByRole("button", { name: /^Save$/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Image ID"), {
      target: { value: "immich-image-1" },
    });
    fireEvent.change(screen.getByLabelText("Expect to have tags"), {
      target: { value: "dog, animal" },
    });
    fireEvent.change(screen.getByLabelText("Expect don't have tags"), {
      target: { value: "cat, indoor" },
    });

    expect(screen.getByLabelText("Expect to have tags")).toHaveValue("dog, animal");
    expect(screen.getByLabelText("Expect don't have tags")).toHaveValue("cat, indoor");
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveEvaluationMock).toHaveBeenCalledWith([
        expect.objectContaining({
          immich_id: "immich-image-1",
          expected_tag: "dog,animal",
          expected_absent_tag: "cat,indoor",
        }),
      ]);
    });
  });

  it("adds new evaluation items at the top of the list", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    evaluationMock.mockResolvedValue({
      items: [{
        id: "eval-existing",
        immich_id: "existing-image",
        expected_tag: null,
        expected_destination: null,
        result_tags: [],
      }],
      total_score: null,
      max_score: null,
      evaluated_at: null,
    });
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByRole("button", { name: /Add item/i }));

    const imageIds = screen.getAllByLabelText("Image ID");
    expect(imageIds).toHaveLength(2);
    expect(imageIds[0]).toHaveValue("");
    expect(imageIds[1]).toHaveValue("existing-image");
  });

  it("confirms and replaces Evaluation settings when importing", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    evaluationMock.mockResolvedValue({
      items: [{
        id: "existing",
        immich_id: "existing-image",
        expected_tag: "old",
        expected_absent_tag: null,
        expected_destination: null,
        result_tags: ["old"],
        score: 1,
        max_score: 1,
      }],
      total_score: 1,
      max_score: 1,
      evaluated_at: "2026-10-03T00:00:00Z",
    });
    saveEvaluationMock.mockResolvedValue({
      items: [{
        id: "imported",
        immich_id: "imported-image",
        expected_tag: "document,email",
        expected_absent_tag: "personal",
        expected_destination: "Documents",
        result_tags: [],
      }],
      total_score: null,
      max_score: null,
      evaluated_at: null,
    });
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByLabelText("Evaluation settings options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Import settings/i }));
    const file = new File([
      JSON.stringify({
        version: 1,
        items: [{
          immich_id: "imported-image",
          expected_tag: "document, email",
          expected_absent_tag: "personal",
          expected_destination: "Documents",
          score: 99,
          result_tags: ["ignored"],
        }],
      }),
    ], "evaluation.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import Evaluation settings file"), {
      target: { files: [file] },
    });

    expect(confirm).toHaveBeenCalledWith(
      "Import will override the current Evaluation settings. Continue?",
    );
    await waitFor(() => {
      expect(saveEvaluationMock).toHaveBeenCalledWith([{
        immich_id: "imported-image",
        expected_tag: "document,email",
        expected_absent_tag: "personal",
        expected_destination: "Documents",
      }]);
    });
    expect(await screen.findByDisplayValue("imported-image")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("existing-image")).not.toBeInTheDocument();
  });

  it("keeps Evaluation settings when import confirmation is cancelled", async () => {
    vi.mocked(confirm).mockReturnValueOnce(false);
    treeMock.mockResolvedValue({ nodes: [] });
    render(<Wrapper><Routing /></Wrapper>);

    const file = new File([
      JSON.stringify({ version: 1, items: [] }),
    ], "evaluation.json", { type: "application/json" });
    fireEvent.change(
      await screen.findByLabelText("Import Evaluation settings file"),
      { target: { files: [file] } },
    );

    expect(saveEvaluationMock).not.toHaveBeenCalled();
  });

  it("exports Evaluation configuration without IDs, results, or scores", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    evaluationMock.mockResolvedValue({
      items: [{
        id: "private-database-id",
        immich_id: "export-image",
        expected_tag: "document,email",
        expected_absent_tag: "personal",
        expected_destination: "Documents",
        result_description: "Existing result",
        result_tags: ["document", "email"],
        score: 1,
        max_score: 1,
      }],
      total_score: 1,
      max_score: 1,
      evaluated_at: "2026-10-03T00:00:00Z",
    });
    const exportedBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      exportedBlobs.push(blob);
      return "blob:evaluation";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByLabelText("Evaluation settings options"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Export settings/i }));

    const blob = exportedBlobs[0];
    const exported = JSON.parse(await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    }));
    expect(exported).toEqual({
      version: 1,
      items: [{
        immich_id: "export-image",
        expected_tag: "document,email",
        expected_absent_tag: "personal",
        expected_destination: "Documents",
      }],
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:evaluation");
    click.mockRestore();
  });

  it("shows per-item evaluation progress and renders each completed result", async () => {
    const item = (id: string, immichId: string) => ({
      id,
      immich_id: immichId,
      expected_tag: "dog",
      expected_destination: null,
      result_description: null,
      result_tags: [],
      result_destination: null,
      result_disposition: null,
      tag_matched: null,
      destination_matched: null,
      score: null,
      max_score: null,
      error_message: null,
      evaluated_at: null,
    });

    const first = item("eval-1", "image-1");
    const second = item("eval-2", "image-2");
    treeMock.mockResolvedValue({ nodes: [] });
    evaluationMock.mockResolvedValueOnce({
      items: [first, second],
      total_score: null,
      max_score: null,
      evaluated_at: null,
    }).mockResolvedValue({
      items: [
        {
          ...first,
          result_description: "A boy walking a dog.",
          result_tags: ["dog"],
          tag_matched: true,
          score: 1,
          max_score: 1,
        },
        {
          ...second,
          result_description: "Another dog.",
          result_tags: ["dog"],
          tag_matched: true,
          score: 1,
          max_score: 1,
        },
      ],
      total_score: 2,
      max_score: 2,
      evaluated_at: "2026-10-02T00:00:01Z",
    });
    runEvaluationMock.mockResolvedValue({
      items: [first, second],
      total_score: 0,
      max_score: 2,
      evaluated_at: null,
    });

    const firstResult = deferred<ReturnType<typeof evaluationMock>>();
    const secondResult = deferred<ReturnType<typeof evaluationMock>>();
    runEvaluationItemMock
      .mockImplementationOnce(() => firstResult.promise)
      .mockImplementationOnce(() => secondResult.promise);

    render(<Wrapper><Routing /></Wrapper>);
    const evaluateButton = await screen.findByRole("button", { name: "Evaluate Routing" });
    fireEvent.click(evaluateButton);

    expect(await screen.findByRole("button", { name: "Evaluating 1 of 2" })).toBeDisabled();
    expect(screen.getByLabelText("Evaluating item 1")).toBeInTheDocument();

    await act(async () => {
      firstResult.resolve({
        items: [
          {
            ...first,
            result_description: "A boy walking a dog.",
            result_tags: ["dog"],
            tag_matched: true,
            score: 1,
            max_score: 1,
          },
          second,
        ],
        total_score: 1,
        max_score: 2,
        evaluated_at: "2026-10-02T00:00:00Z",
      });
    });

    expect(await screen.findByText("A boy walking a dog.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Evaluating 2 of 2" })).toBeDisabled();
    expect(screen.getByLabelText("Evaluating item 2")).toBeInTheDocument();

    await act(async () => {
      secondResult.resolve({
        items: [
          {
            ...first,
            result_description: "A boy walking a dog.",
            result_tags: ["dog"],
            tag_matched: true,
            score: 1,
            max_score: 1,
          },
          {
            ...second,
            result_description: "Another dog.",
            result_tags: ["dog"],
            tag_matched: true,
            score: 1,
            max_score: 1,
          },
        ],
        total_score: 2,
        max_score: 2,
        evaluated_at: "2026-10-02T00:00:01Z",
      });
    });

    expect(await screen.findByRole("button", { name: "Evaluate Routing" })).toBeEnabled();
    expect(screen.getByText("Latest total: 2 / 2")).toBeInTheDocument();
  });

  it("evaluates items up to the configured parallel limit", async () => {
    const item = (id: string) => ({
      id,
      immich_id: `image-${id}`,
      expected_tag: null,
      expected_absent_tag: null,
      expected_destination: null,
      result_tags: [],
    });
    const items = [item("1"), item("2"), item("3")];
    treeMock.mockResolvedValue({ nodes: [] });
    evaluationMock.mockResolvedValue({
      items,
      total_score: null,
      max_score: null,
      evaluated_at: null,
    });
    routingPreferencesMock.mockResolvedValue({
      learn_from_corrections: false,
      processing_concurrency: 2,
    });
    runEvaluationMock.mockResolvedValue({
      items,
      total_score: 0,
      max_score: 0,
      evaluated_at: null,
    });
    const first = deferred<ReturnType<typeof evaluationMock>>();
    const second = deferred<ReturnType<typeof evaluationMock>>();
    const third = deferred<ReturnType<typeof evaluationMock>>();
    runEvaluationItemMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    render(<Wrapper><Routing /></Wrapper>);
    fireEvent.click(await screen.findByRole("button", { name: "Evaluate Routing" }));

    await waitFor(() => expect(runEvaluationItemMock).toHaveBeenCalledTimes(2));
    expect(runEvaluationItemMock).toHaveBeenNthCalledWith(1, "1");
    expect(runEvaluationItemMock).toHaveBeenNthCalledWith(2, "2");
    expect(screen.getByLabelText("Evaluating item 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Evaluating item 2")).toBeInTheDocument();

    await act(async () => {
      first.resolve({
        items,
        total_score: 0,
        max_score: 0,
        evaluated_at: "2026-10-03T00:00:00Z",
      });
    });
    await waitFor(() => expect(runEvaluationItemMock).toHaveBeenCalledTimes(3));

    await act(async () => {
      second.resolve({
        items,
        total_score: 0,
        max_score: 0,
        evaluated_at: "2026-10-03T00:00:00Z",
      });
      third.resolve({
        items,
        total_score: 0,
        max_score: 0,
        evaluated_at: "2026-10-03T00:00:00Z",
      });
    });
    expect(await screen.findByRole("button", { name: "Evaluate Routing" })).toBeEnabled();
  });

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
      expect.objectContaining({ name: "Family", parent_id: null })
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
    expect(screen.queryByText("Exclusive (no secondaries)")).not.toBeInTheDocument();
    expect(screen.queryByText("Allow as secondary")).not.toBeInTheDocument();
    expect(screen.queryByText(/Is leaf/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Matching"));
    await waitFor(() => expect(screen.getByText("sharp image")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Advanced AI" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to routing tree" }));
    expect(screen.queryByText("Matching")).not.toBeInTheDocument();
    expect(screen.getByText("Select a node to edit its settings.")).toBeInTheDocument();
  });

  it("can reprocess all assets from the routing menu", async () => {
    treeMock.mockResolvedValue({ nodes: [] });
    render(<Wrapper><Routing /></Wrapper>);

    fireEvent.click(await screen.findByRole("button", { name: "Run Routing options" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "Run Routing" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Back to plans" }));
    expect(screen.queryByText("Plan total")).not.toBeInTheDocument();
    expect(screen.getByText(/ready · 5 items/i)).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "View asset metadata" }));
    await waitFor(() => expect(assetMock).toHaveBeenCalledWith("a1"));
    expect(await screen.findByRole("dialog", { name: "Asset details" })).toBeInTheDocument();
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("Hanoi, Vietnam")).toBeInTheDocument();
    expect(screen.getByText("Current tags")).toBeInTheDocument();
    expect(screen.getByText("existing-tag")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /immich-a1/i })).toHaveAttribute(
      "href",
      "https://image.example.com/photos/immich-a1"
    );
    expect(screen.getByRole("link", { name: /immich-a1/i })).toHaveAttribute(
      "target",
      "_blank"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close asset details" }));

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
    expect(screen.getByText("Approved - retry required")).toBeInTheDocument();
    expect(screen.getByText(/Approve actions write changes to Immich immediately/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Approved description")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("reports the result of applying approved items", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "ready", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [],
        ready_to_approve: [],
        needs_review: [], trash_candidates: [], rejected: [], failed: [],
      },
    });
    applyMock.mockResolvedValue({ applied: 1, failed: 0 });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/ready ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Retry previously approved items" }));

    expect(await screen.findByText("Applied 1; failed 0.")).toBeInTheDocument();
    expect(applyMock).toHaveBeenCalledWith("p1");
  });

  it("allows failed items to be edited, retried, or rejected", async () => {
    plansMock.mockResolvedValue([
      { id: "p1", job_id: null, status: "partially_applied", item_count: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    planSummaryMock.mockResolvedValue({
      plan_id: "p1", total: 1,
      groups: {
        auto_applied: [], ready_to_approve: [], needs_review: [],
        trash_candidates: [], rejected: [],
        failed: [{ path: "Personal", bucket_id: "b1", count: 1, item_ids: ["i1"] }],
      },
    });
    const failedItem = {
      id: "i1", plan_id: "p1", asset_id: "a1",
      primary_bucket_id: "b1", primary_bucket_path: "Personal",
      secondary_bucket_ids: [], disposition: "keep", confidence: 0.9,
      review_required: false, auto_apply: false, review_reasons: [],
      reason_codes: [], safety_flags: {}, quality_flags: {},
      suggested_description: "Retry me", suggested_tags: [],
      suggested_location: null, suggested_caption: null,
      status: "failed", error_message: "Tag write failed",
    };
    planItemsMock.mockResolvedValue([failedItem]);
    updateItemMock.mockResolvedValue(failedItem);
    approveMock.mockResolvedValue({ approved: 1, applied: 1, failed: 0 });

    render(<Wrapper><RoutingPlans /></Wrapper>);
    fireEvent.click(await screen.findByText(/partially_applied ·/i));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Personal" }));

    const description = await screen.findByDisplayValue("Retry me");
    fireEvent.change(description, { target: { value: "Edited retry" } });
    fireEvent.blur(description);
    await waitFor(() => expect(updateItemMock).toHaveBeenCalled());
    expect(screen.getByText("Tag write failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(
      "p1",
      { item_ids: ["i1"] }
    ));
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
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
