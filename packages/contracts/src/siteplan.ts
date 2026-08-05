import { z } from "zod";
import { NoNumeralsText, NumericSlotRef } from "./common.js";
import type { Blueprint, ComponentDef, SlotDef } from "./blueprint.js";

/**
 * SitePlan — the ONLY artifact the AI authors in step 7. References only:
 * numeric slots hold `ext:`/`doc:` refs, free text is numeral-fenced, and
 * validateSitePlan() enforces both against the locked blueprint before the
 * deterministic renderer ever runs.
 */

export const ChartSpec = z.object({
  type: z.enum(["bar", "groupedBar", "line", "waterfall", "donut"]),
  series: z.array(
    z.object({
      label_ref: NumericSlotRef,
      values: z.array(NumericSlotRef),
    }),
  ),
  category_refs: z.array(NumericSlotRef),
  value_format: z.literal("inherit"),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const SlotValue = z.union([z.string(), ChartSpec]);
export type SlotValue = z.infer<typeof SlotValue>;

export const ComponentInstance = z.object({
  component: z.string().regex(/^bp:/),
  variant: z.string().optional(),
  slots: z.record(z.string(), SlotValue),
});
export type ComponentInstance = z.infer<typeof ComponentInstance>;

export const SitePage = z.object({
  path: z.string(),
  template: z.string().regex(/^bp:/),
  title: z.string(),
  regions: z.record(z.string(), z.array(ComponentInstance)),
  downloads: z
    .array(z.object({ kind: z.enum(["pdf", "xlsx"]), tables: z.array(z.string()).default([]) }))
    .default([]),
});

export const SitePlan = z.object({
  schema_version: z.literal("siteplan/1"),
  site_plan_id: z.string(),
  doc_model_id: z.string(),
  blueprint_version_id: z.string(),
  blueprint_checksum: z.string(),
  model: z.string(),
  iteration: z.number().int(),
  nav: z.array(z.object({ label: NoNumeralsText, href: z.string() })),
  pages: z.array(SitePage),
  validation: z.object({
    status: z.enum(["valid", "invalid", "unvalidated"]),
    errors: z.array(z.string()),
  }),
});
export type SitePlan = z.infer<typeof SitePlan>;

// ── Plan validation against the locked blueprint ──────────────────────────────

const NUMERAL = /[0-9]/;

export interface PlanViolation {
  page: string;
  region?: string;
  component?: string;
  slot?: string;
  rule: string;
  detail: string;
}

/**
 * Structural enforcement of the two product guarantees at plan time:
 * unknown components/slots are unrepresentable, numeric slots are refs,
 * microcopy carries no numerals, regions accept only declared components.
 * Ref RESOLUTION (does the cell exist?) is Gate A, run by the verifier with
 * the ExtractionResult in hand — not here.
 */
export function validateSitePlan(plan: SitePlan, blueprint: Blueprint): PlanViolation[] {
  const v: PlanViolation[] = [];
  const components = new Map<string, ComponentDef>(
    blueprint.components.map((c) => [c.id, c]),
  );
  const templates = new Map(blueprint.page_templates.map((t) => [t.id, t]));

  if (plan.blueprint_checksum !== blueprint.checksum) {
    v.push({
      page: "*",
      rule: "blueprint-checksum",
      detail: `plan pinned to ${plan.blueprint_checksum.slice(0, 12)}… but blueprint is ${blueprint.checksum.slice(0, 12)}…`,
    });
  }

  for (const nav of plan.nav) {
    if (NUMERAL.test(nav.label)) {
      v.push({ page: "*", rule: "microcopy-numeral", detail: `nav label "${nav.label}"` });
    }
  }

  for (const page of plan.pages) {
    const tpl = templates.get(page.template);
    if (!tpl) {
      v.push({ page: page.path, rule: "unknown-template", detail: page.template });
      continue;
    }
    const regionDefs = new Map(tpl.regions.map((r) => [r.id, r]));

    for (const [regionId, instances] of Object.entries(page.regions)) {
      const regionDef = regionDefs.get(regionId);
      if (!regionDef) {
        v.push({ page: page.path, region: regionId, rule: "unknown-region", detail: `template ${tpl.id} has no region "${regionId}"` });
        continue;
      }
      for (const inst of instances) {
        const def = components.get(inst.component);
        if (!def) {
          v.push({ page: page.path, region: regionId, component: inst.component, rule: "unknown-component", detail: "not in blueprint inventory" });
          continue;
        }
        const shortName = def.id.replace(/^bp:cmp_/, "");
        if (
          regionDef.accepts.length > 0 &&
          !regionDef.accepts.includes(def.id) &&
          !regionDef.accepts.includes(shortName)
        ) {
          v.push({ page: page.path, region: regionId, component: def.id, rule: "region-accepts", detail: `region "${regionId}" accepts [${regionDef.accepts.join(", ")}]` });
        }
        if (inst.variant && !def.variants.includes(inst.variant)) {
          v.push({ page: page.path, component: def.id, rule: "unknown-variant", detail: inst.variant });
        }
        for (const [slotName, slotDef] of Object.entries(def.slots)) {
          const value = inst.slots[slotName];
          if (value === undefined) {
            if (slotDef.required !== false) {
              v.push({ page: page.path, component: def.id, slot: slotName, rule: "missing-slot", detail: "required slot absent" });
            }
            continue;
          }
          v.push(...checkSlot(page.path, def.id, slotName, slotDef, value));
        }
        for (const slotName of Object.keys(inst.slots)) {
          if (!def.slots[slotName]) {
            v.push({ page: page.path, component: def.id, slot: slotName, rule: "unknown-slot", detail: "slot not declared on component" });
          }
        }
      }
    }
    for (const rd of tpl.regions) {
      const count = page.regions[rd.id]?.length ?? 0;
      if (count < rd.min) {
        v.push({ page: page.path, region: rd.id, rule: "region-min", detail: `has ${count}, needs ≥ ${rd.min}` });
      }
      if (rd.max !== null && count > rd.max) {
        v.push({ page: page.path, region: rd.id, rule: "region-max", detail: `has ${count}, max ${rd.max}` });
      }
    }
  }
  return v;
}

function checkSlot(
  page: string,
  component: string,
  slot: string,
  def: SlotDef,
  value: SlotValue,
): PlanViolation[] {
  const at = { page, component, slot };
  switch (def.type) {
    case "text": {
      if (typeof value !== "string")
        return [{ ...at, rule: "slot-type", detail: "expected string" }];
      if (NUMERAL.test(value))
        return [{ ...at, rule: "microcopy-numeral", detail: `"${value.slice(0, 60)}"` }];
      if (def.max_chars && value.length > def.max_chars)
        return [{ ...at, rule: "text-length", detail: `${value.length} > ${def.max_chars}` }];
      return [];
    }
    case "ref": {
      if (typeof value !== "string" || !NumericSlotRef.safeParse(value).success)
        return [{ ...at, rule: "ref-required", detail: `ref slot must match ^(ext:|doc:), got "${String(value).slice(0, 60)}"` }];
      return [];
    }
    case "enum": {
      if (typeof value !== "string" || !def.values.includes(value))
        return [{ ...at, rule: "enum-value", detail: `expected one of [${def.values.join(", ")}]` }];
      return [];
    }
    case "asset": {
      if (typeof value !== "string" || !value.startsWith("bp:"))
        return [{ ...at, rule: "asset-ref", detail: "asset slots take bp:asset ids" }];
      return [];
    }
    case "chart": {
      const parsed = ChartSpec.safeParse(value);
      if (!parsed.success)
        return [{ ...at, rule: "chart-spec", detail: "invalid ChartSpec (values must be refs)" }];
      return [];
    }
  }
}
