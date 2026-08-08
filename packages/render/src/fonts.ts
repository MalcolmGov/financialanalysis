/**
 * Self-hosted webfonts for multipage IR sites.
 * Open Sans matches DRDGOLD / DNA stack (fontsource-selfhost provider).
 * Font files ship under packages/render/fonts/ and are copied to assets/fonts/.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FONT_FILES = [
  { file: "open-sans-latin-400-normal.woff2", weight: 400 },
  { file: "open-sans-latin-700-normal.woff2", weight: 700 },
  { file: "open-sans-latin-800-normal.woff2", weight: 800 },
] as const;

function fontsDir(): string {
  // dist/ → ../fonts ; src/ → ../fonts
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../fonts"), join(here, "../../fonts")];
  for (const c of candidates) {
    if (existsSync(join(c, FONT_FILES[0].file))) return c;
  }
  return candidates[0]!;
}

/** Relative href to a font file from a page path. */
export function fontHrefFromPage(pagePath: string, file: string): string {
  const depth = pagePath.includes("/") ? pagePath.split("/").filter(Boolean).length - 1 : 0;
  const prefix = depth > 0 ? "../".repeat(depth) : "";
  return `${prefix}assets/fonts/${file}`;
}

/**
 * @font-face CSS using relative paths from the given page
 * (so nested financials/ pages resolve correctly).
 */
export function fontFaceCss(pagePath = "index.html"): string {
  const faces = FONT_FILES.map((f) => {
    const href = fontHrefFromPage(pagePath, f.file);
    return `@font-face{font-family:"Open Sans";font-style:normal;font-weight:${f.weight};font-display:swap;src:url("${href}") format("woff2")}`;
  });
  return `/* rs-fonts */\n${faces.join("\n")}`;
}

/** Binary font files for the export zip (assets/fonts/…). */
export function fontAssetBinaries(): Record<string, Uint8Array> {
  const dir = fontsDir();
  const out: Record<string, Uint8Array> = {};
  for (const f of FONT_FILES) {
    const path = join(dir, f.file);
    if (!existsSync(path)) continue;
    out[`assets/fonts/${f.file}`] = new Uint8Array(readFileSync(path));
  }
  return out;
}

export function hasSelfHostedFonts(): boolean {
  return Object.keys(fontAssetBinaries()).length > 0;
}
