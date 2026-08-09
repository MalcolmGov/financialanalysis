/**
 * IR multipage theme presets — shared extraction/render engine, different chrome.
 * Brand DNA (--dna-*) and logo still apply on top of the preset.
 */

export const IR_THEME_IDS = ["classic", "editorial"] as const;
export type IrThemeId = (typeof IR_THEME_IDS)[number];

export const IR_THEME_META: Record<
  IrThemeId,
  { label: string; blurb: string; bestFor: string }
> = {
  classic: {
    label: "Classic IR",
    blurb: "Dark masthead, statement-forward chrome (current default).",
    bestFor: "Mining, industrial, traditional interim packs",
  },
  editorial: {
    label: "Editorial Light",
    blurb: "Lighter hero, commentary-first emphasis, airier cards.",
    bestFor: "Retail, consumer, AFS-style packs with strong prose",
  },
};

export function normalizeIrThemeId(raw: unknown): IrThemeId {
  if (raw === "editorial") return "editorial";
  return "classic";
}

export function themeIdFromDna(dna: { theme_id?: unknown } | null | undefined): IrThemeId {
  return normalizeIrThemeId(dna?.theme_id);
}

export interface IrThemeSuggestInput {
  company?: string | null;
  periodLabel?: string | null;
  docKind?: string | null;
  toneWords?: string[] | null;
  sectionKinds?: string[] | null;
  /** Free-text haystack (titles, tone, company). */
  signals?: string[] | null;
}

/**
 * Soft auto-suggest for the console picker. Operator can always override.
 * Heuristics only — never invents financial content.
 */
export function suggestIrThemeId(input: IrThemeSuggestInput): {
  themeId: IrThemeId;
  reason: string;
} {
  const hay = [
    input.company ?? "",
    input.periodLabel ?? "",
    input.docKind ?? "",
    ...(input.toneWords ?? []),
    ...(input.sectionKinds ?? []),
    ...(input.signals ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const editorialHits =
    /\b(retail|consumer|grocery|supermarket|spar|woolworth|shoprite|pick\s*n\s*pay|afs|annual\s*financial|letter|editorial|brand-led)\b/.test(
      hay,
    ) ||
    (input.sectionKinds ?? []).some((k) =>
      /letter|opsReview|dividendDeclaration/i.test(k),
    );

  const classicHits =
    /\b(mining|gold|platinum|coal|metal|drdgold|drd|resource|interim\s*results|industrial)\b/.test(
      hay,
    );

  if (editorialHits && !classicHits) {
    return {
      themeId: "editorial",
      reason: "Retail/consumer or commentary-heavy pack → Editorial Light",
    };
  }
  if (classicHits && !editorialHits) {
    return {
      themeId: "classic",
      reason: "Mining/industrial interim signals → Classic IR",
    };
  }
  if (editorialHits && classicHits) {
    return {
      themeId: "editorial",
      reason: "Mixed signals; preferring Editorial when prose/retail cues present",
    };
  }
  return {
    themeId: "classic",
    reason: "Default Classic IR (dark masthead, statement-forward)",
  };
}
