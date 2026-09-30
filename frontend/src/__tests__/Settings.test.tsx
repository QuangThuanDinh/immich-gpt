import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  getRoutingPreferences: vi.fn().mockResolvedValue({ learn_from_corrections: false }),
  saveRoutingPreferences: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({ status: "ok" }),
}));

import { getImmichSettings } from "../services/api";

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
