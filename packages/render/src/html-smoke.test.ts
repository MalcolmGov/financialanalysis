import { describe, expect, it } from "vitest";
import { htmlBundleSmoke } from "./html-smoke";

describe("htmlBundleSmoke", () => {
  it("passes a self-contained relative pack", () => {
    const report = htmlBundleSmoke({
      "index.html": `<a href="commentary.html">C</a><a href="assets/site.css">css</a>`,
      "commentary.html": `<a href="index.html">Home</a>`,
      "assets/site.css": "body{}",
    });
    expect(report.status).toBe("pass");
    expect(report.dangling).toEqual([]);
    expect(report.external).toEqual([]);
  });

  it("flags dangling pages and CDNs", () => {
    const report = htmlBundleSmoke({
      "index.html": `<a href="missing.html">x</a><script src="https://cdn.example/app.js"></script>`,
    });
    expect(report.status).toBe("fail");
    expect(report.dangling.some((d) => d.includes("missing.html"))).toBe(true);
    expect(report.external.some((u) => u.includes("cdn.example"))).toBe(true);
  });
});
