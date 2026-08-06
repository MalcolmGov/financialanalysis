import { MODELS, generateStructured, imageBlock, type Usage } from "./anthropic";

/**
 * Step 3 — vision DNA analysis. claude-opus-5 reads the 2x page renders and
 * assigns semantic ROLES to the document's colors, plus motifs, tone words,
 * table treatment and theme mode. It reads what the deterministic probe cannot:
 * what each measured color is *for*. The reconciler then snaps these role reads
 * to the probe's measured hexes.
 */

export interface VisionDNA {
  palette_roles: { role: string; hex: string; note?: string }[];
  motifs: { id: string; kind: "photography" | "logo" | "text" | "pattern"; notes: string; value?: string }[];
  tone_words: string[];
  theme_mode: "single-light" | "single-dark" | "dual";
  table_treatment: string;
  heading_color_role: string;
}

const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["palette_roles", "motifs", "tone_words", "theme_mode", "table_treatment", "heading_color_role"],
  properties: {
    palette_roles: {
      type: "array",
      description: "Every meaningful color and the role it plays.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "hex"],
        properties: {
          role: {
            type: "string",
            description:
              "One of: paper, ink, brand, accent, masthead-bg, table-header-bg, table-header-text, table-shading, footer-accent, or a descriptive role.",
          },
          hex: { type: "string", description: "Approx #RRGGBB as seen." },
          note: { type: "string" },
        },
      },
    },
    motifs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "notes"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["photography", "logo", "text", "pattern"] },
          notes: { type: "string" },
          value: { type: "string", description: "For text motifs, the tagline/wordmark verbatim." },
        },
      },
    },
    tone_words: { type: "array", items: { type: "string" }, description: "4-6 words for the document's character." },
    theme_mode: { type: "string", enum: ["single-light", "single-dark", "dual"] },
    table_treatment: { type: "string", description: "Prose description of how tables are styled." },
    heading_color_role: { type: "string", description: "Which palette role colors section headings." },
  },
} as const;

const SYSTEM = `You are a brand-identity analyst reading a company's printed financial-results document. From the page images, extract the document's visual identity precisely and literally — describe what is actually there, not what would look good. Assign each meaningful color a role (masthead background, section-heading accent, table-header fill, current-period shading, brand mark, body ink, paper). Name the motifs (photographic banners, logos, taglines — quote taglines verbatim). Decide the theme mode from the document itself: if it is light with dark accents, that is "single-light" — do not invent a dark mode. Report hex values as you perceive them; exact measured values come from a separate probe.`;

export async function analyzeVision(pageImages: Buffer[]): Promise<{ vision: VisionDNA; usage: Usage }> {
  // Cap the number of page images sent (stratified in the real path; here we
  // take the cover + a sample). Cover is the richest identity signal.
  const images = pageImages.slice(0, 8);
  const content: Parameters<typeof generateStructured>[0]["messages"][number]["content"] = [
    ...images.map((b) => imageBlock(b)),
    {
      type: "text",
      text: "Analyze these results-document pages and return the design DNA. The first image is the cover — weight it most.",
    },
  ];
  const { data, usage } = await generateStructured<VisionDNA>({
    model: MODELS.vision,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    schema: VISION_SCHEMA as unknown as Record<string, unknown>,
    effort: "high",
    maxTokens: 6000,
  });
  return { vision: data, usage };
}
