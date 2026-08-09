import type { DesignDNA } from "@rs/contracts";
import type { VisionDNA } from "./vision";

/**
 * Step 3 reconciler. Merges the deterministic probe (measured hexes, no roles)
 * with the vision pass (roles, no exact values): for each role the vision
 * assigned, snap to the nearest probe-measured color within a ΔE tolerance and
 * adopt that exact value (provenance probe+vision, high confidence); if no probe
 * color is close, keep the vision hex at low confidence and raise a flag for the
 * DNA card. Deltas use CIEDE2000 from @rs/render (imported dynamically to keep
 * linkedom out of the workflow sandbox graph).
 */

const DELTA_E_ADOPT = 10;

export async function reconcileDna(
  probeDna: DesignDNA,
  vision: VisionDNA,
): Promise<DesignDNA> {
  const { nearestDeltaE, deltaE2000, hexToLab, IR_NEUTRAL_FALLBACKS } = await import("@rs/render");
  const measured = probeDna.palette.measured.map((m) => m.hex);

  const roles: DesignDNA["palette"]["roles"] = {};
  const flags: DesignDNA["confidence"]["flags"] = [];

  for (const vr of vision.palette_roles) {
    const hex = normalizeHex(vr.hex);
    if (!hex) continue;
    // Find the closest measured probe color to the vision-read hex.
    let bestHex = hex;
    let bestDe = Infinity;
    const visLab = hexToLab(hex);
    if (visLab) {
      for (const m of measured) {
        const mLab = hexToLab(m);
        if (!mLab) continue;
        const de = deltaE2000(visLab, mLab);
        if (de < bestDe) {
          bestDe = de;
          bestHex = m;
        }
      }
    }
    const adopted = bestDe <= DELTA_E_ADOPT;
    roles[vr.role] = {
      hex: adopted ? bestHex : hex,
      provenance: adopted ? "probe+vision" : "vision",
      confidence: adopted ? 0.92 : 0.5,
      ...(vr.note ? {} : {}),
    };
    if (!adopted) {
      flags.push({
        path: `palette.roles.${vr.role}`,
        reason: `no probe-measured color within ΔE ${DELTA_E_ADOPT} (nearest ${bestDe === Infinity ? "n/a" : bestDe.toFixed(1)}); using vision estimate`,
        confidence: 0.5,
      });
    }
  }

  // Ensure load-bearing roles exist. Missing brand/masthead → neutral IR slate
  // (never DRDGOLD gold/olive — those come only from measured issuer DNA).
  if (!roles.paper) {
    roles.paper = { hex: IR_NEUTRAL_FALLBACKS.paper, provenance: "probe", confidence: 0.7 };
  }
  if (!roles.ink) {
    roles.ink = { hex: IR_NEUTRAL_FALLBACKS.ink, provenance: "probe", confidence: 0.6 };
  }
  if (!roles.brand) {
    roles.brand = { hex: IR_NEUTRAL_FALLBACKS.brand, provenance: "probe", confidence: 0.35 };
    flags.push({
      path: "palette.roles.brand",
      reason: "vision omitted brand; using neutral IR slate (not DRDGOLD gold)",
      confidence: 0.35,
    });
  }
  if (!roles["masthead-bg"]) {
    roles["masthead-bg"] = {
      hex: IR_NEUTRAL_FALLBACKS.masthead,
      provenance: "probe",
      confidence: 0.35,
    };
    flags.push({
      path: "palette.roles.masthead-bg",
      reason: "vision omitted masthead-bg; using neutral IR slate (not DRDGOLD olive)",
      confidence: 0.35,
    });
  }

  const overall = weightedOverall(roles);

  const toneWords = vision.tone_words;
  const { suggestIrThemeId } = await import("@rs/render");
  const suggested = suggestIrThemeId({
    company: probeDna.project_id,
    toneWords,
    signals: toneWords,
  });

  return {
    ...probeDna,
    revision: probeDna.revision,
    confidence: { overall, flags },
    palette: { ...probeDna.palette, roles },
    type: {
      ...probeDna.type,
      heading_treatment: {
        ...probeDna.type.heading_treatment,
        color: vision.heading_color_role || probeDna.type.heading_treatment.color,
      },
    },
    motifs: vision.motifs.map((m) => ({
      id: m.id,
      kind: m.kind,
      notes: m.notes,
      ...(m.value ? { value: m.value } : {}),
      ...(m.kind === "photography" ? { asset_role: "banner" } : m.kind === "logo" ? { asset_role: "logo" } : {}),
    })),
    tone_words: toneWords,
    theme: { mode: vision.theme_mode, rationale: "assigned by vision from the document's own light/dark treatment" },
    // Soft default — operator can override at DNA approve / site review.
    theme_id: suggested.themeId,
  };
}

function weightedOverall(roles: DesignDNA["palette"]["roles"]): number {
  const loadBearing = ["brand", "accent", "table-header-bg", "ink", "paper"];
  const vals = loadBearing.map((r) => roles[r]?.confidence).filter((c): c is number => c != null);
  if (vals.length === 0) return 0.5;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

function normalizeHex(h: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(h.trim());
  if (m) return `#${m[1].toUpperCase()}`;
  const s = /^#?([0-9a-fA-F]{3})$/.exec(h.trim());
  if (s) {
    const [r, g, b] = s[1].split("");
    return `#${(r + r + g + g + b + b).toUpperCase()}`;
  }
  return null;
}
