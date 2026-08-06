import type { Blueprint, FinancialDocModel, SitePlan } from "@rs/contracts";

/**
 * FinancialDocModel → SitePlan (references only). This is the deterministic
 * baseline the AI styling pass refines within the locked blueprint — but even
 * unrefined it is a valid, ref-only, gate-passing plan. It places every
 * must-appear table into a statement-table component so Gate A coverage is
 * satisfied by construction.
 *
 * The AI's later role is compositional (which comparison to chart, section
 * pacing, hero framing) — never numeric. A digit is unrepresentable in the
 * plan it produces because the slots are ref-typed.
 */

function firstComponentAccepting(blueprint: Blueprint, kind: "table"): string | null {
  for (const c of blueprint.components) {
    for (const slot of Object.values(c.slots)) {
      if (slot.type === "ref" && (slot.accepts === kind || slot.accepts === "any")) return c.id;
    }
  }
  return null;
}

function tableSlotName(blueprint: Blueprint, componentId: string): string | null {
  const comp = blueprint.components.find((c) => c.id === componentId);
  if (!comp) return null;
  for (const [name, slot] of Object.entries(comp.slots)) {
    if (slot.type === "ref" && (slot.accepts === "table" || slot.accepts === "any")) return name;
  }
  return null;
}

function firstStatementTemplate(blueprint: Blueprint): string {
  const named = blueprint.page_templates.find((t) => /statement|prose|main|cover/i.test(t.id + t.name));
  return (named ?? blueprint.page_templates[0]).id;
}

function firstRegionAccepting(blueprint: Blueprint, templateId: string, componentId: string): string {
  const tpl = blueprint.page_templates.find((t) => t.id === templateId)!;
  const short = componentId.replace(/^bp:cmp_/, "");
  const region = tpl.regions.find(
    (r) => r.accepts.includes(componentId) || r.accepts.includes(short) || r.accepts.length === 0,
  );
  return (region ?? tpl.regions[0]).id;
}

export function buildSitePlan(docModel: FinancialDocModel, blueprint: Blueprint): SitePlan {
  const tableComponent = firstComponentAccepting(blueprint, "table");
  const template = firstStatementTemplate(blueprint);
  const pages: SitePlan["pages"] = [];

  if (tableComponent) {
    const slotName = tableSlotName(blueprint, tableComponent)!;
    const region = firstRegionAccepting(blueprint, template, tableComponent);
    // One statements page carrying every financial table (baseline layout).
    pages.push({
      path: "statements/index.html",
      template,
      title: "Financial statements",
      regions: {
        [region]: docModel.tables.map((t) => ({
          component: tableComponent,
          slots: { [slotName]: t.id },
        })),
      },
      downloads: [],
    });
  }

  return {
    schema_version: "siteplan/1",
    site_plan_id: `sp_${docModel.doc_model_id}`,
    doc_model_id: docModel.doc_model_id,
    blueprint_version_id: blueprint.blueprint_version_id,
    blueprint_checksum: blueprint.checksum,
    model: "deterministic-baseline",
    iteration: 0,
    nav: [{ label: "Financial statements", href: "statements/index.html" }],
    pages,
    validation: { status: "unvalidated", errors: [] },
  };
}
