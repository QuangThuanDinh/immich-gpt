import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Login from "../pages/Login";
import { getOIDCStatus } from "../services/api";

vi.mock("../contexts/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("../services/api", () => ({ getOIDCStatus: vi.fn() }));
vi.mock("../components/BrandLogo", () => ({ default: () => <div>Immich GPT</div> }));

describe("OIDC-only login", () => {
  beforeEach(() => {
    vi.mocked(getOIDCStatus).mockResolvedValue({ configured: true, login_url: "/api/auth/oidc/login" });
  });

  it("only offers OIDC with no username, password, setup or reset controls", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Sign in with OIDC" })).toBeEnabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
  });

  it("disables login and explains missing environment configuration", async () => {
    vi.mocked(getOIDCStatus).mockResolvedValue({ configured: false, login_url: "/api/auth/oidc/login" });
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/OIDC environment variables/);
    expect(screen.getByRole("button", { name: "Sign in with OIDC" })).toBeDisabled();
  });

  it("shows configuration lookup errors without offering password fallback", async () => {
    vi.mocked(getOIDCStatus).mockRejectedValue(new Error("Provider configuration unavailable"));
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Provider configuration unavailable/);
    expect(screen.getByRole("button", { name: "Sign in with OIDC" })).toBeDisabled();
  });
});
