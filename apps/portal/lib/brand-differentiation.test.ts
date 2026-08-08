import { describe, expect, it } from "vitest";
import { assessBrandDifferentiation } from "./brand-differentiation";
import { DRDGOLD_REFERENCE_PROJECT } from "./reference-projects";

describe("assessBrandDifferentiation", () => {
  it("passes DRDGOLD reference with DNA gold", () => {
    const a = assessBrandDifferentiation({
      projectId: DRDGOLD_REFERENCE_PROJECT.id,
      company: "DRDGOLD Limited",
      brandHex: "#FCAF17",
      mastheadHex: "#0F3B2E",
      clientLogo: true,
      brandLogo: true,
    });
    expect(a.isReferenceIssuer).toBe(true);
    expect(a.status).toBe("pass");
    expect(a.critical).toBe(false);
  });

  it("fails non-DRD with empty kit and neutral DNA", () => {
    const a = assessBrandDifferentiation({
      projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      company: "Acme Mining Limited",
      brandHex: "#243B53",
      mastheadHex: "#1B2A3A",
      clientLogo: false,
      brandLogo: false,
    });
    expect(a.status).toBe("fail");
    expect(a.critical).toBe(true);
    expect(a.brandDifferentiated).toBe(false);
  });

  it("fails non-DRD that still carries DRDGOLD palette without kit logo", () => {
    const a = assessBrandDifferentiation({
      projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      company: "Other Issuer Ltd",
      brandHex: "#FCAF17",
      mastheadHex: "#0F3B2E",
      clientLogo: false,
      brandLogo: true,
    });
    expect(a.status).toBe("fail");
    expect(a.critical).toBe(true);
  });

  it("passes differentiated non-DRD issuer", () => {
    const a = assessBrandDifferentiation({
      projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      company: "Other Issuer Ltd",
      brandHex: "#C8102E",
      mastheadHex: "#111827",
      clientLogo: true,
      brandLogo: true,
    });
    expect(a.status).toBe("pass");
    expect(a.brandDifferentiated).toBe(true);
  });
});
