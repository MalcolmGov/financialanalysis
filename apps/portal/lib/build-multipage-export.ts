import { createHash, randomUUID } from "node:crypto";
import type { Blueprint, DesignDNA, ExtractionResult } from "@rs/contracts";
import { Blueprint as BlueprintSchema } from "@rs/contracts";
import { buildSitePlan, mapToDocModel } from "@rs/mapper";
import { renderSitePlan } from "@rs/render";
import { buildBlueprintV1 } from "./build-blueprint";

export interface MultipageExportInput {
  dna: DesignDNA;
  extraction: ExtractionResult;
  projectId: string;
  company: string;
  periodLabel: string;
  /** Optional signed-off prototype HTML kept under prototype/index.html. */
  prototypeHtml?: string | null;
  sourcePrototypeVersionId?: string;
  sourcePrototypeSha256?: string;
}

export interface MultipageExportResult {
  files: Record<string, string>;
  paths: string[];
  sitePlanId: string;
  blueprintVersionId: string;
  entrypoint: string;
  mode: "multipage";
}

function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Deterministic WW-style multi-page site from DNA tokens + extraction/docmodel.
 * Numbers come only from extraction via the SitePlan renderer.
 */
export function buildMultipageExport(input: MultipageExportInput): MultipageExportResult {
  const blueprintVersionId = randomUUID();
  const draft = buildBlueprintV1({
    dna: input.dna,
    blueprintVersionId,
    projectId: input.projectId,
    cycle: 1,
    sourcePrototypeVersionId: input.sourcePrototypeVersionId ?? "prototype-export",
    sourcePrototypeSha256: input.sourcePrototypeSha256 ?? "0".repeat(64),
  });
  const checksum = sha256Hex(JSON.stringify(draft));
  const blueprint = BlueprintSchema.parse({ ...draft, checksum }) as Blueprint;

  const meta = {
    company: input.company,
    period_label: input.periodLabel,
    doc_kind: "interim_unaudited" as const,
    currency: "ZAR",
  };
  const docModel = mapToDocModel(input.extraction, meta);
  const sitePlan = buildSitePlan(docModel, blueprint);
  const { files } = renderSitePlan(sitePlan, blueprint, {
    extraction: input.extraction,
    docModel,
  });

  if (input.prototypeHtml) {
    files["prototype/index.html"] = input.prototypeHtml;
  }

  // Prefer multi-page index; never overwrite a rendered multipage home with the
  // single-file prototype (prototype lives under prototype/ as reference).
  if (!files["index.html"] && input.prototypeHtml) {
    files["index.html"] = input.prototypeHtml;
  }

  const paths = Object.keys(files).sort();
  return {
    files,
    paths,
    sitePlanId: sitePlan.site_plan_id,
    blueprintVersionId,
    entrypoint: "index.html",
    mode: "multipage",
  };
}
