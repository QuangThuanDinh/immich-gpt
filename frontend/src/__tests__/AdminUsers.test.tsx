import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import AdminUsers from "../pages/AdminUsers";

vi.mock("../services/api", () => ({
  adminListUsers: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUser: vi.fn(),
  adminResetPassword: vi.fn(),
  adminDeleteUser: vi.fn(),
}));

import { adminListUsers, adminResetPassword } from "../services/api";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <AdminUsers />
    </QueryClientProvider>
  );
}

describe("AdminUsers", () => {
  beforeEach(() => {
    vi.mocked(adminListUsers).mockResolvedValue([
      {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        role: "user",
        is_active: true,
        force_password_change: false,
        created_at: "2026-05-05T10:00:00Z",
      },
    ]);
    vi.mocked(adminResetPassword).mockResolvedValue({
      token: "sensitive-reset-token",
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies reset tokens without rendering the secret", async () => {
    renderPage();

    await userEvent.click(await screen.findByTitle("Reset password"));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("sensitive-reset-token");
    });
    expect(screen.getByText(/copied to your clipboard/i)).toBeInTheDocument();
    expect(screen.queryByText("sensitive-reset-token")).not.toBeInTheDocument();
  });

  it("renders every user action", async () => {
    renderPage();

    expect(await screen.findByTitle("Disable")).toBeInTheDocument();
    expect(screen.getByTitle("Reset password")).toBeInTheDocument();
    expect(screen.getByTitle("Require password change")).toBeInTheDocument();
    expect(screen.getByTitle("Delete user")).toBeInTheDocument();
  });

  it("uses one Tab stop with parent and child arrow navigation", async () => {
    vi.mocked(adminListUsers).mockResolvedValue([
      {
        id: "user-1",
        email: "first@example.com",
        username: "first",
        role: "user",
        is_active: true,
        force_password_change: false,
        created_at: "2026-05-05T10:00:00Z",
      },
      {
        id: "user-2",
        email: "second@example.com",
        username: "second",
        role: "user",
        is_active: true,
        force_password_change: false,
        created_at: "2026-05-06T10:00:00Z",
      },
    ]);
    renderPage();

    const first = await screen.findByRole("row", { name: "User first" });
    const second = screen.getByRole("row", { name: "User second" });
    const firstDisable = within(first).getByRole("button", { name: "Disable" });
    const firstReset = within(first).getByRole("button", { name: "Reset password" });
    const firstDelete = within(first).getByRole("button", { name: "Delete user" });

    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(firstDisable).toHaveAttribute("tabindex", "-1");

    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(firstDisable).toHaveFocus();
    fireEvent.keyDown(firstDisable, { key: "ArrowRight" });
    expect(firstReset).toHaveFocus();
    fireEvent.keyDown(firstReset, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(firstDelete).toHaveFocus();
    fireEvent.keyDown(firstDelete, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(first).toHaveFocus();
  });
});
