import { describe, expect, it } from "vitest";
import { formatDateTime, parseApiDateTime } from "../utils/datetime";

describe("timezone date formatting", () => {
  it("treats API timestamps without offsets as UTC", () => {
    expect(parseApiDateTime("2026-01-01T12:00:00").toISOString()).toBe(
      "2026-01-01T12:00:00.000Z"
    );
  });

  it("formats equivalent timestamps consistently in the configured timezone", () => {
    const naive = formatDateTime("2026-01-01T12:00:00", "America/Vancouver");
    const explicitUtc = formatDateTime("2026-01-01T12:00:00Z", "America/Vancouver");
    const utc = formatDateTime("2026-01-01T12:00:00Z", "UTC");

    expect(naive).toBe(explicitUtc);
    expect(naive).not.toBe(utc);
  });
});
