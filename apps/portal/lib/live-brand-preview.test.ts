import { describe, expect, it } from "vitest";
import { liveBrandTokens, normalizeBrandHex } from "./live-brand-preview";

describe("normalizeBrandHex", () => {
  it("normalizes short and long hex", () => {
    expect(normalizeBrandHex("#fc0")).toBe("#FFCC00");
    expect(normalizeBrandHex("ffcb04")).toBe("#FFCB04");
    expect(normalizeBrandHex("#FFCB04")).toBe("#FFCB04");
    expect(normalizeBrandHex("nope")).toBeNull();
  });
});

describe("liveBrandTokens", () => {
  it("uses dark on-brand text for MTN yellow", () => {
    const t = liveBrandTokens("#FFCB04");
    expect(t?.brightBrand).toBe(true);
    expect(t?.onBrand).toBe("#231F20");
    expect(t?.brandText).toBe("#231F20");
    expect(t?.footerAccent).toBe("#FFCB04");
  });

  it("uses paper on-brand text for dark navy brands", () => {
    const t = liveBrandTokens("#1B2A3A");
    expect(t?.brightBrand).toBe(false);
    expect(t?.onBrand).toBe("#FFFFFF");
    expect(t?.brandText).toBe("#1B2A3A");
  });
});
