import { parseHTML } from "linkedom";
import { CONFORMANCE, type DesignDNA } from "@rs/contracts";
import { isNeutral, nearestDeltaE } from "./color.js";

/**
 * The no-generic-templates conformance linter — the shared gate every prototype
 * version (including the studio's v1) must pass before it is reviewable, and
 * the check that makes lossless blueprint extraction possible. Enforcement, not
 * intention: a lazy Inter-on-white output fails here.
 */

export interface LintError {
  rule: string;
  detail: string;
}
export interface LintResult {
  passed: boolean;
  errors: LintError[];
  warnings: LintError[];
}

const HEX = /#[0-9a-fA-F]{3,6}\b/g;
const EXTERNAL_URL = /\b(?:src|href)\s*=\s*["']https?:\/\//i;
const CSS_EXTERNAL = /url\(\s*["']?https?:\/\//i;

// Palette fingerprints of the generic looks the rule exists to exclude.
const BANNED_HEXES = new Set(
  [
    "#3b82f6", "#6366f1", "#8b5cf6", "#10b981", "#ef4444", "#f59e0b", // Tailwind
    "#0d6efd", "#007bff", "#6c757d", // Bootstrap
    "#667eea", "#764ba2", // the purple-gradient hero
  ].map((h) => h.toLowerCase()),
);
const BANNED_FONTS = ["inter", "roboto", "system-ui", "-apple-system"];

function dnaPalette(dna: DesignDNA): string[] {
  const out: string[] = [];
  for (const entry of Object.values(dna.palette.roles)) out.push(entry.hex);
  for (const entry of dna.palette.measured) out.push(entry.hex);
  return out;
}

export function conformanceLint(html: string, dna: DesignDNA): LintResult {
  const errors: LintError[] = [];
  const warnings: LintError[] = [];
  const { document } = parseHTML(html);

  // Gather CSS text from <style> blocks and inline style attributes.
  const styleText = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  const inlineStyles = Array.from(document.querySelectorAll("[style]"))
    .map((el) => el.getAttribute("style") ?? "")
    .join("\n");
  const allCss = `${styleText}\n${inlineStyles}`;

  const palette = dnaPalette(dna);
  // Analyse APPLIED colors only — strip :root{…} token *definitions*, which
  // declare the palette rather than use it (and would double-count neutrals).
  const appliedCss = allCss.replace(/:root\s*\{[^}]*\}/gi, " ");
  const hexes = (appliedCss.match(HEX) ?? []).map((h) => h.toLowerCase());

  let colorUsages = 0;
  let neutralUsages = 0;
  const brandColorsApplied = new Set<string>();
  for (const hex of hexes) {
    colorUsages++;
    if (BANNED_HEXES.has(hex)) {
      errors.push({ rule: "banned-palette", detail: `${hex} is a generic framework palette value` });
      continue;
    }
    if (isNeutral(hex)) {
      neutralUsages++;
      continue;
    }
    const dE = nearestDeltaE(hex, palette);
    if (dE > CONFORMANCE.DELTA_E_TOLERANCE) {
      errors.push({
        rule: "non-dna-color",
        detail: `${hex} is ΔE ${dE.toFixed(1)} from the nearest DNA color (max ${CONFORMANCE.DELTA_E_TOLERANCE})`,
      });
    } else {
      brandColorsApplied.add(hex);
    }
  }

  // Near-monochrome guard: the design must actually apply the brand's
  // distinctive (non-neutral, DNA-derived) colors — not pass as a greyscale
  // card grid with one lone accent.
  if (colorUsages > 0 && brandColorsApplied.size < CONFORMANCE.MIN_DISTINCT_BRAND_COLORS) {
    errors.push({
      rule: "near-monochrome",
      detail: `only ${brandColorsApplied.size} distinct brand color(s) applied (min ${CONFORMANCE.MIN_DISTINCT_BRAND_COLORS}) — output reads as generic`,
    });
  }
  if (colorUsages > 0 && neutralUsages / colorUsages > CONFORMANCE.NEUTRAL_COVERAGE_WARN) {
    warnings.push({
      rule: "high-neutral-share",
      detail: `${((neutralUsages / colorUsages) * 100).toFixed(0)}% of applied colors are neutral`,
    });
  }

  // Generic font fingerprints when the DNA did not produce them.
  const dnaFamilies = dna.type.faces.map((f) => f.family.toLowerCase());
  const fontDecls = allCss.match(/font-family\s*:[^;}\n]+/gi) ?? [];
  for (const decl of fontDecls) {
    const primary = decl.split(":")[1]?.split(",")[0]?.trim().replace(/["']/g, "").toLowerCase() ?? "";
    if (BANNED_FONTS.includes(primary) && !dnaFamilies.some((f) => f.includes(primary))) {
      errors.push({ rule: "generic-font", detail: `primary font "${primary}" is a generic default not present in the DNA` });
    }
  }

  // Zero external requests — MNPI + self-contained bundle guarantee.
  if (EXTERNAL_URL.test(html) || CSS_EXTERNAL.test(allCss)) {
    errors.push({ rule: "external-request", detail: "external http(s) URL found; prototypes must be self-contained" });
  }

  // Self-describing prototype: components must be annotated for blueprint extraction.
  if (document.querySelectorAll(`[${CONFORMANCE.DATA_COMPONENT_ATTR}]`).length === 0) {
    errors.push({
      rule: "missing-annotations",
      detail: `no [${CONFORMANCE.DATA_COMPONENT_ATTR}] elements; blueprint extraction needs component annotations`,
    });
  }

  return { passed: errors.length === 0, errors, warnings };
}
