import { describe, expect, it } from "vitest";
import { classifyHost, hostOperatorCopy } from "./runtime-host";

describe("classifyHost", () => {
  it("treats Railway as the pipeline host", () => {
    expect(classifyHost("portal-production-518a.up.railway.app")).toBe("pipeline");
  });

  it("treats Vercel as UI-only", () => {
    expect(classifyHost("portal-alpha-drab.vercel.app")).toBe("ui-preview");
    expect(hostOperatorCopy("ui-preview").label).toMatch(/Vercel/);
  });

  it("treats loopback as local", () => {
    expect(classifyHost("localhost:3000")).toBe("local");
    expect(classifyHost("127.0.0.1")).toBe("local");
  });
});
