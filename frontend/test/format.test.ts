import { describe, it, expect } from "vitest";
import {
  shortenAddress,
  shortenHash,
  formatDate,
  formatTinybarAsHbar,
  secondsUntil,
} from "../src/lib/format";

describe("shortenAddress", () => {
  it("keeps the first 6 and last 4 characters", () => {
    expect(shortenAddress("0xe07B6c410590B998F3E16bf90507F9Be38bF6176")).toBe("0xe07B...6176");
  });
});

describe("shortenHash", () => {
  it("truncates a 32-byte hash the same way as an address", () => {
    expect(
      shortenHash("0xbbeeba47a3f5a5b1ef80b51064ceadd26572ad833863659f60258eafae84abd4"),
    ).toBe("0xbbee...abd4");
  });
});

describe("formatDate", () => {
  it("renders Unix seconds as a UTC YYYY-MM-DD date", () => {
    // 2027-01-15T00:00:00Z
    expect(formatDate(1799971200n)).toBe("2027-01-15");
  });

  it("does not shift by a day near a UTC midnight boundary", () => {
    // 2027-09-05T00:00:00Z, exactly as written elsewhere in the beacon read
    expect(formatDate(1820102400n)).toBe("2027-09-05");
  });
});

describe("formatTinybarAsHbar", () => {
  it("divides by 1e8, not 1e18 — the tinybar/weibar bug this project already hit once", () => {
    // The real distribute() payout observed live in this project.
    expect(formatTinybarAsHbar(41_095_890n)).toBe("0.4110");
  });

  it("handles zero", () => {
    expect(formatTinybarAsHbar(0n)).toBe("0.0000");
  });
});

describe("secondsUntil", () => {
  it("is positive when the target is in the future", () => {
    expect(secondsUntil(200n, 100n)).toBe(100n);
  });

  it("is negative when the target has already passed — callers decide what that means", () => {
    expect(secondsUntil(100n, 200n)).toBe(-100n);
  });
});
