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
  getProviderModels: vi.fn().mockResolvedValue([]),
  getRoutingPreferences: vi.fn().mockResolvedValue({
    learn_from_corrections: false,
    processing_concurrency: 1,
  }),
  saveRoutingPreferences: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({ status: "ok" }),
}));

import {
  getImmichSettings,
  getRoutingPreferences,
  saveRoutingPreferences,
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
    vi.mocked(getImmichSettings).mockResolvedValue({
      immich_url: "http://immich.example",
      connected: true,
      asset_count: 42,
    });
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
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Add Provider/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "openrouter" },
    });

    expect(screen.getByPlaceholderText("https://openrouter.ai/api/v1")).toBeInTheDocument();
    expect(screen.getByText(/complete API base URL/i)).toBeInTheDocument();
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
