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
  adminDeleteUser: vi.fn(),
}));

import { adminListUsers, adminCreateUser } from "../services/api";

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
  });

  it("pre-creates OIDC accounts without password controls", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /New User/ }));
    expect(screen.queryByText("Password")).not.toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    await userEvent.type(inputs[1], "new-oidc-user");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(adminCreateUser).toHaveBeenCalledWith({ email: "", username: "new-oidc-user", role: "user" }, expect.anything());
    });
  });

  it("renders every user action", async () => {
    renderPage();

    expect(await screen.findByTitle("Disable")).toBeInTheDocument();
    expect(screen.queryByTitle("Reset password")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Require password change")).not.toBeInTheDocument();
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
    const firstDelete = within(first).getByRole("button", { name: "Delete user" });

    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(firstDisable).toHaveAttribute("tabindex", "-1");

    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(firstDisable).toHaveFocus();
    fireEvent.keyDown(firstDisable, { key: "ArrowRight" });
    expect(firstDelete).toHaveFocus();
    fireEvent.keyDown(firstDelete, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(firstDelete).toHaveFocus();
    fireEvent.keyDown(firstDelete, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(first).toHaveFocus();
  });
});
