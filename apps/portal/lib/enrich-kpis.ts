import { MODELS, generateStructured } from "./anthropic";

/**
 * Split a merged "Highlights" block into KPI cards. Docling flattens the six
 * cover cards into running text ("Operating profit increased by 72% to
 * R2 712.8 million Headline earnings increased by 99% to R1 932.4 million …"),
 * and the reversed grammar of some cards defeats a regex — so a cheap
 * classify-only pass (haiku) segments them.
 *
 * NUMBER SAFETY: the model only SEGMENTS existing text; every returned `value`
 * is validated to be a verbatim substring of the source (whitespace-tolerant).
 * A value the model altered or invented is dropped. (Prototype KPIs are design
 * draft anyway — the exported numbers still flow through the ref-verified path.)
 */

const KPI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kpis"],
  properties: {
    kpis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: { type: "string", description: "The descriptor, e.g. 'Operating profit increased by 72% to'. No numerals unless part of the descriptor phrase." },
          value: { type: "string", description: "The headline figure exactly as written, e.g. 'R2 712.8 million', '50 SA cps', '48%', '2 337 kilograms'." },
        },
      },
    },
  },
} as const;

const SYSTEM =
  "You segment a company's printed 'Highlights' band, which has been flattened into running text, back into its individual highlight cards. Return each card as a {label, value} pair. Copy the value figure EXACTLY as it appears — do not reformat, round, or alter any digit or separator. Do not invent cards; only split what is present.";

const norm = (s: string) => s.replace(/\s+/g, "");

export async function extractKpis(highlightsText: string): Promise<{ label: string; value: string }[]> {
  if (!highlightsText.trim()) return [];
  const { data } = await generateStructured<{ kpis: { label: string; value: string }[] }>({
    model: MODELS.classify,
    system: SYSTEM,
    messages: [{ role: "user", content: `Highlights text:\n${highlightsText}\n\nSplit into KPI cards.` }],
    schema: KPI_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1500,
  });
  const src = norm(highlightsText);
  // Verbatim guard: keep only cards whose value appears verbatim in the source.
  return (data.kpis ?? []).filter((k) => k.value && src.includes(norm(k.value))).slice(0, 6);
}
