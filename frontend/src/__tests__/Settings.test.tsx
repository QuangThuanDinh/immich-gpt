import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Settings from "../pages/Settings";

vi.mock("../services/api", () => ({
  getImmichSettings: vi.fn(),
  saveImmichSettings: vi.fn(),
  testImmichConnection: vi.fn(),
  getProviders: vi.fn().mockResolvedValue([]),
  upsertProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
  testCurrentProvider: vi.fn(),
  getProviderModels: vi.fn().mockResolvedValue([]),
  getCurrentProviderModels: vi.fn().mockResolvedValue([]),
  getRoutingPreferences: vi.fn().mockResolvedValue({
    learn_from_corrections: false,
    processing_concurrency: 1,
  }),
  saveRoutingPreferences: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({ status: "ok" }),
}));

import {
  getImmichSettings,
  getCurrentProviderModels,
  getProviderModels,
  getProviders,
  getRoutingPreferences,
  saveRoutingPreferences,
  testProvider,
  testCurrentProvider,
  upsertProvider,
} from "../services/api";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>
  );
}

describe("Settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getImmichSettings).mockResolvedValue({
      immich_url: "http://immich.example",
      connected: true,
      asset_count: 42,
    });
    vi.mocked(getProviders).mockResolvedValue([]);
    vi.mocked(getProviderModels).mockResolvedValue([]);
    vi.mocked(getCurrentProviderModels).mockResolvedValue([]);
    vi.mocked(testProvider).mockResolvedValue({ connected: true });
    vi.mocked(testCurrentProvider).mockResolvedValue({ connected: true });
  });

  it("fills the Immich URL input after settings load", async () => {
    renderPage();

    const input = await screen.findByDisplayValue("http://immich.example");
    expect(input).toBeInTheDocument();
  });

  it("saves per-user parallel processing concurrency", async () => {
    vi.mocked(saveRoutingPreferences).mockResolvedValue({
      learn_from_corrections: false,
      processing_concurrency: 4,
    });
    renderPage();

    const input = await screen.findByLabelText("Parallel AI processes");
    const saveButton = screen.getByRole("button", { name: "Save Preferences" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(getRoutingPreferences).toHaveBeenCalled();
      expect(saveRoutingPreferences).toHaveBeenCalledWith({
        learn_from_corrections: false,
        processing_concurrency: 4,
      });
    });
  });

  it("allows an optional OpenRouter base URL", async () => {
    vi.mocked(getProviderModels).mockResolvedValue([
      { id: "saved-provider-model", name: "saved-provider-model" },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Add Provider/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "openrouter" },
    });

    expect(screen.getByPlaceholderText("https://openrouter.ai/api/v1")).toBeInTheDocument();
    expect(screen.getByText(/complete API base URL/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("openai/gpt-4o").tagName).toBe("INPUT");
    expect(screen.queryByText("saved-provider-model")).not.toBeInTheDocument();
    expect(getProviderModels).not.toHaveBeenCalled();
  });

  it("preserves the saved model when it is unavailable", async () => {
    const provider: Awaited<ReturnType<typeof getProviders>>[number] = {
      id: "openrouter-id",
      provider_name: "openrouter",
      enabled: true,
      is_default: true,
      base_url: "http://host.docker.internal:4000/v1",
      model_name: "openai/gpt-4o",
      has_api_key: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.mocked(getProviders).mockResolvedValue([provider]);
    vi.mocked(getProviderModels).mockResolvedValue([
      { id: "gpt-5-mini-1", name: "gpt-5-mini-1" },
    ]);
    vi.mocked(upsertProvider).mockResolvedValue(provider);
    renderPage();

    fireEvent.click(await screen.findByTitle("Edit provider"));
    expect(await screen.findByRole("combobox")).toHaveValue("openai/gpt-4o");
    expect(screen.getByRole("option", { name: "openai/gpt-4o" })).toBeInTheDocument();
    expect(screen.getByTitle("Saved model is not available from the provider")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Provider" }));

    await waitFor(() => {
      expect(upsertProvider).toHaveBeenCalled();
      expect(vi.mocked(upsertProvider).mock.calls[0][0]).toEqual(
        expect.objectContaining({ model_name: "openai/gpt-4o" }),
      );
    });
  });

  it("refreshes the model list every time a provider is edited", async () => {
    const provider: Awaited<ReturnType<typeof getProviders>>[number] = {
      id: "openrouter-id",
      provider_name: "openrouter",
      enabled: true,
      is_default: true,
      base_url: "http://host.docker.internal:4000/v1",
      model_name: "saved-model",
      has_api_key: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.mocked(getProviders).mockResolvedValue([provider]);
    vi.mocked(getProviderModels)
      .mockResolvedValueOnce([{ id: "first-model", name: "first-model" }])
      .mockResolvedValueOnce([{ id: "latest-model", name: "latest-model" }]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));
    expect(await screen.findByText("✓ Connected")).toBeInTheDocument();
    fireEvent.click(await screen.findByTitle("Edit provider"));
    expect(await screen.findByRole("option", { name: "first-model" })).toBeInTheDocument();
    expect(screen.queryByText("✓ Connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test Current Settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Edit provider"));
    expect(await screen.findByRole("option", { name: "latest-model" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "first-model" })).not.toBeInTheDocument();
    expect(getProviderModels).toHaveBeenCalledTimes(2);

    vi.mocked(getCurrentProviderModels).mockResolvedValue([
      { id: "reloaded-model", name: "reloaded-model" },
    ]);
    fireEvent.change(
      screen.getByDisplayValue("http://host.docker.internal:4000/v1"),
      { target: { value: "http://host.docker.internal:4001/v1" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload models from current settings" }),
    );
    expect(await screen.findByRole("option", { name: "reloaded-model" })).toBeInTheDocument();
    expect(getCurrentProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        base_url: "http://host.docker.internal:4001/v1",
      }),
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "reloaded-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Current Settings" }));

    await waitFor(() => {
      expect(testCurrentProvider).toHaveBeenCalledWith(
        expect.objectContaining({ model_name: "reloaded-model" }),
        expect.anything(),
      );
    });
    expect(await screen.findByText("✓ Current settings connected")).toBeInTheDocument();
    expect(upsertProvider).not.toHaveBeenCalled();
  });

  it("supports standard and Azure OpenAI configuration", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Add Provider/i }));

    expect(screen.getByPlaceholderText("https://api.openai.com/v1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("2024-10-21")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("my-gpt-4o-deployment")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("https://api.openai.com/v1"), {
      target: { value: "https://resource.openai.azure.com/openai/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("my-gpt-4o-deployment"), {
      target: { value: "vision-deployment" },
    });

    expect(screen.getByText(/Azure Base URL may end with \/openai\/v1/i)).toBeInTheDocument();
    expect(screen.getByText("Uses Azure deployment")).toBeInTheDocument();
  });
});
