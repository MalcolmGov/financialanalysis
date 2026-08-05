/**
 * Emits JSON Schemas for every cross-boundary contract into jsonschema/.
 * These are checked in; the Python worker generates its pydantic models from
 * them (datamodel-code-generator) — never hand-duplicated.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as C from "../src/index.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "jsonschema");
mkdirSync(out, { recursive: true });

const registry: Record<string, z.ZodType> = {
  "artifact-ref": C.ArtifactRef,
  "upload-record": C.UploadRecord,
  "extraction-job-submit": C.ExtractionJobSubmit,
  "extraction-status": C.ExtractionStatus,
  "extraction-webhook": C.ExtractionWebhook,
  "extraction-result-pointer": C.ExtractionResultPointer,
  "extraction-result": C.ExtractionResult,
  "client-brief": C.ClientBrief,
  "design-dna": C.DesignDNA,
  "dna-correction": C.DnaCorrection,
  "brand-asset-bundle": C.BrandAssetBundle,
  "prototype-spec": C.PrototypeSpec,
  "prototype-artifact": C.PrototypeArtifact,
  blueprint: C.Blueprint,
  "financial-doc-model": C.FinancialDocModel,
  "site-plan": C.SitePlan,
  "number-audit-report": C.NumberAuditReport,
  "qa-report": C.QAReport,
  "export-bundle": C.ExportBundle,
  "pipeline-input": C.PipelineInput,
  "progress-event": C.ProgressEvent,
};

let failures = 0;
for (const [name, schema] of Object.entries(registry)) {
  try {
    const json = z.toJSONSchema(schema, { reused: "ref" });
    writeFileSync(join(out, `${name}.json`), JSON.stringify(json, null, 2) + "\n");
    console.log(`✓ ${name}.json`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${(err as Error).message}`);
  }
}
if (failures > 0) process.exit(1);
