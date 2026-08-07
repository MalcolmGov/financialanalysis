/**
 * Deterministic highlight → KPI card segmentation for multipage home.
 * Values must appear as verbatim substrings of the source highlights text
 * (whitespace-tolerant). No AI — P2 motion foundation; P3/V2 deepen editorial.
 */

export interface HomeKpiCard {
  label: string;
  /** Short IR title for card chrome (derived from label; no invented figures). */
  shortTitle: string;
  /** Optional movement badge text copied from the source phrase (e.g. "▲ 72%"). */
  delta?: string;
  /** Full display string copied from source (e.g. "R2 712.8 million"). */
  display: string;
  /** Numeric magnitude for count-up animation. */
  countup: number;
  decimals: number;
  sep: string;
  /** Optional leading unit kept outside the animated span. */
  prefix: string;
  /** Optional trailing unit kept outside the animated span. */
  suffix: string;
  /** Animated inner text (digits + grouping), verbatim from source. */
  valueText: string;
  fromSrc?: string;
}

const NBSP = /\u00a0/g;

function normWs(s: string): string {
  return s.replace(NBSP, " ").replace(/\s+/g, " ").trim();
}

function compact(s: string): string {
  return s.replace(NBSP, "").replace(/\s+/g, "");
}

/** Extract a numeric magnitude + decimals from a display fragment. */
function parseMagnitude(display: string): { countup: number; decimals: number; sep: string; valueText: string; prefix: string; suffix: string } | null {
  const d = normWs(display);
  // R2 712.8 million / R1 651.3 million
  let m = /^R\s*([\d][\d\s]*\.?\d*)\s*(million)$/i.exec(d);
  if (m) {
    const valueText = m[1]!.replace(/\s+/g, " ").trim();
    const countup = parseFloat(valueText.replace(/\s/g, ""));
    if (isNaN(countup)) return null;
    const decimals = valueText.includes(".") ? (valueText.split(".")[1]?.length ?? 0) : 0;
    return { countup, decimals, sep: " ", valueText, prefix: "R", suffix: ` ${m[2]}` };
  }
  // 50 SA cps
  m = /^([\d][\d\s]*\.?\d*)\s*(SA\s*cps)$/i.exec(d);
  if (m) {
    const valueText = m[1]!.replace(/\s+/g, " ").trim();
    const countup = parseFloat(valueText.replace(/\s/g, ""));
    if (isNaN(countup)) return null;
    const decimals = valueText.includes(".") ? (valueText.split(".")[1]?.length ?? 0) : 0;
    return { countup, decimals, sep: " ", valueText, prefix: "", suffix: ` ${normWs(m[2]!)}` };
  }
  // 48%
  m = /^([\d][\d\s]*\.?\d*)\s*%$/i.exec(d);
  if (m) {
    const valueText = m[1]!.replace(/\s+/g, " ").trim();
    const countup = parseFloat(valueText.replace(/\s/g, ""));
    if (isNaN(countup)) return null;
    const decimals = valueText.includes(".") ? (valueText.split(".")[1]?.length ?? 0) : 0;
    return { countup, decimals, sep: "", valueText, prefix: "", suffix: "%" };
  }
  // 2 337 kilograms
  m = /^([\d][\d\s]*\.?\d*)\s*(kilograms?|kg)$/i.exec(d);
  if (m) {
    const valueText = m[1]!.replace(/\s+/g, " ").trim();
    const countup = parseFloat(valueText.replace(/\s/g, ""));
    if (isNaN(countup)) return null;
    const decimals = valueText.includes(".") ? (valueText.split(".")[1]?.length ?? 0) : 0;
    return { countup, decimals, sep: " ", valueText, prefix: "", suffix: ` ${m[2]}` };
  }
  // Fallback: first number in the string
  m = /([\d][\d\s\u00a0]*\.?\d*)/.exec(d);
  if (!m) return null;
  const valueText = m[1]!.replace(NBSP, " ").replace(/\s+/g, " ").trim();
  const countup = parseFloat(valueText.replace(/\s/g, ""));
  if (isNaN(countup)) return null;
  const decimals = valueText.includes(".") ? (valueText.split(".")[1]?.length ?? 0) : 0;
  const idx = d.indexOf(m[1]!);
  const prefix = d.slice(0, idx).trim();
  const suffix = d.slice(idx + m[1]!.length).trim();
  return {
    countup,
    decimals,
    sep: valueText.includes(" ") ? " " : "",
    valueText,
    prefix: prefix ? `${prefix}` : "",
    suffix: suffix ? ` ${suffix}` : "",
  };
}

/**
 * Derive a short IR title + optional delta badge from a source label phrase.
 * Titles are lexical only; delta digits must already appear in `label`.
 */
export function presentKpiLabel(label: string): { shortTitle: string; delta?: string } {
  const L = normWs(label);
  const up = (m: RegExpMatchArray | null) =>
    m ? `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)}` : null;

  let m = /^(Operating profit)\s+increased by\s+(\d+%)/i.exec(L);
  if (m) return { shortTitle: "Operating Profit", delta: `▲ ${m[2]}` };
  m = /^(Headline earnings)\s+increased by\s+(\d+%)/i.exec(L);
  if (m) return { shortTitle: "Headline Earnings", delta: `▲ ${m[2]}` };
  m = /^(Gold production)\s+decreased by\s+(\d+%)/i.exec(L);
  if (m) return { shortTitle: "Gold Production", delta: `▼ ${m[2]}` };
  m = /^(Gold production)\s+increased by\s+(\d+%)/i.exec(L);
  if (m) return { shortTitle: "Gold Production", delta: `▲ ${m[2]}` };
  if (/^Interim cash dividend/i.test(L)) {
    return { shortTitle: "Interim Cash Dividend", delta: "Declared" };
  }
  if (/^Capital expenditure$/i.test(L)) {
    return { shortTitle: "Capital Expenditure", delta: "Invested" };
  }
  m = /All-in sustaining costs margin/i.exec(L);
  if (m) {
    return { shortTitle: "AISC Margin" };
  }
  // Generic: title-case first noun phrase before "increased/decreased/of"
  m = /^([A-Za-z][A-Za-z\s/-]+?)(?:\s+(?:increased|decreased|of)\b|$)/i.exec(L);
  const titled = up(m);
  if (titled) return { shortTitle: titled };
  return { shortTitle: L };
}

type Extractor = (src: string) => { label: string; display: string; end: number } | null;

/** Ordered IR highlight extractors (DRD-style flattened cover band). */
const EXTRACTORS: Extractor[] = [
  (src) => {
    const m =
      /(Operating profit increased by \d+%\s+to)\s+(R[\d\s\u00a0]+\.?\d*\s*million)/i.exec(
        src,
      );
    return m
      ? { label: normWs(m[1]!), display: normWs(m[2]!), end: (m.index ?? 0) + m[0].length }
      : null;
  },
  (src) => {
    const m =
      /(Headline earnings increased by \d+%\s+to)\s+(R[\d\s\u00a0]+\.?\d*\s*million)/i.exec(
        src,
      );
    return m
      ? { label: normWs(m[1]!), display: normWs(m[2]!), end: (m.index ?? 0) + m[0].length }
      : null;
  },
  (src) => {
    const m = /(Interim cash dividend of)\s+([\d\s\u00a0]+\.?\d*\s*SA\s*cps)/i.exec(src);
    return m
      ? { label: normWs(m[1]!), display: normWs(m[2]!), end: (m.index ?? 0) + m[0].length }
      : null;
  },
  (src) => {
    const m = /(R[\d\s\u00a0]+\.?\d*\s*million)\s+of capital expenditure/i.exec(src);
    return m
      ? {
          label: "Capital expenditure",
          display: normWs(m[1]!),
          end: (m.index ?? 0) + m[0].length,
        }
      : null;
  },
  (src) => {
    const m =
      /(All-in sustaining costs margin(?:\s+\d+)?\s+of)\s+([\d\s\u00a0]+\.?\d*\s*%)/i.exec(
        src,
      );
    return m
      ? { label: normWs(m[1]!), display: normWs(m[2]!), end: (m.index ?? 0) + m[0].length }
      : null;
  },
  (src) => {
    const m =
      /(Gold production decreased by \d+%\s+to)\s+([\d\s\u00a0]+\.?\d*\s*kilograms?)/i.exec(
        src,
      );
    return m
      ? { label: normWs(m[1]!), display: normWs(m[2]!), end: (m.index ?? 0) + m[0].length }
      : null;
  },
];

function toCard(
  label: string,
  display: string,
  mag: NonNullable<ReturnType<typeof parseMagnitude>>,
  fromSrc?: string,
): HomeKpiCard {
  const present = presentKpiLabel(label);
  return {
    label,
    shortTitle: present.shortTitle,
    delta: present.delta,
    display,
    countup: mag.countup,
    decimals: mag.decimals,
    sep: mag.sep,
    prefix: mag.prefix,
    suffix: mag.suffix.trim(),
    valueText: mag.valueText,
    fromSrc,
  };
}

/**
 * Segment flattened highlights prose into up to 6 KPI cards.
 * Every `display` / `valueText` is a verbatim substring of `highlightsText`
 * (after NBSP→space normalisation for matching only — digits unchanged).
 */
export function segmentHighlightKpis(
  highlightsText: string,
  fromSrc?: string,
): HomeKpiCard[] {
  const src = normWs(highlightsText);
  if (!src) return [];
  const srcCompact = compact(highlightsText);
  const cards: HomeKpiCard[] = [];
  let rest = src;

  for (const extract of EXTRACTORS) {
    if (cards.length >= 6) break;
    const hit = extract(rest);
    if (!hit) {
      // Also try against the full source (non-contiguous after prior consumes).
      const fromFull = extract(src);
      if (!fromFull) continue;
      if (cards.some((c) => c.display === fromFull.display && c.label === fromFull.label)) {
        continue;
      }
      if (!srcCompact.includes(compact(fromFull.display))) continue;
      const mag = parseMagnitude(fromFull.display);
      if (!mag || !srcCompact.includes(compact(mag.valueText))) continue;
      cards.push(toCard(fromFull.label, fromFull.display, mag, fromSrc));
      continue;
    }
    if (!srcCompact.includes(compact(hit.display))) continue;
    const mag = parseMagnitude(hit.display);
    if (!mag || !srcCompact.includes(compact(mag.valueText))) continue;
    cards.push(toCard(hit.label, hit.display, mag, fromSrc));
    rest = rest.slice(hit.end);
  }

  return cards;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render KPI grid HTML. Values use data-allow-number + data-countup; digits from source. */
export function renderKpiCardsHtml(cards: HomeKpiCard[]): string {
  if (!cards.length) return "";
  const items = cards
    .map((c) => {
      const sepAttr = c.sep === "" ? ' data-sep=""' : ` data-sep="${escapeHtml(c.sep)}"`;
      const prefixOutside = c.prefix ? escapeHtml(c.prefix) : "";
      const suf = c.suffix.replace(/^\s+/, "");
      // Keep % glued; put a space before word suffixes (million, SA cps, kilograms).
      const suffixOutside = !suf
        ? ""
        : suf.startsWith("%")
          ? escapeHtml(suf)
          : ` ${escapeHtml(suf)}`;
      // Animate only the numeric core; prefix/suffix stay stable around it.
      const span = `<span data-countup="${c.countup}" data-decimals="${c.decimals}"${sepAttr} data-final="${escapeHtml(c.valueText)}" data-allow-number>${escapeHtml(c.valueText)}</span>`;
      const from = c.fromSrc ? ` data-kpi-from="${escapeHtml(c.fromSrc)}"` : "";
      const delta = c.delta
        ? `<p class="kpi-delta" data-allow-number>${escapeHtml(c.delta)}</p>`
        : "";
      // Context line keeps the full source phrase for provenance / screen readers.
      return `<article class="kpi-card reveal"${from}><div class="kpi-card__top"><p class="kpi-title">${escapeHtml(c.shortTitle)}</p>${delta}</div><p class="kpi-value">${prefixOutside}${span}${suffixOutside}</p><p class="kpi-label" data-allow-number>${escapeHtml(c.label)}</p></article>`;
    })
    .join("");
  return `<section class="kpi-grid" aria-label="Key figures" data-dna-component="kpi-grid">${items}</section>`;
}
