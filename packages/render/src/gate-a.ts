import type { ChartSpec, SitePlan } from "@rs/contracts";
import { refResolves, type ResolveContext } from "./resolve.js";

/**
 * Gate A — referential integrity, pre-render. Every ref in the SitePlan
 * resolves to a real source cell, and every cell a must-appear table declares
 * is placed exactly once. Omission is a failure, not just corruption.
 */

export interface GateAResult {
  status: "pass" | "fail";
  dangling_refs: string[];
  coverage: { must_appear_cells: number; placed: number; missing: string[] };
}

function* planRefs(plan: SitePlan): Generator<string> {
  for (const page of plan.pages) {
    for (const instances of Object.values(page.regions)) {
      for (const inst of instances) {
        for (const value of Object.values(inst.slots)) {
          if (typeof value === "string" && (value.startsWith("ext:") || value.startsWith("doc:"))) {
            yield value;
          } else if (value && typeof value === "object" && "series" in value) {
            const spec = value as ChartSpec;
            for (const s of spec.series) {
              yield s.label_ref;
              for (const v of s.values) yield v;
            }
            for (const c of spec.category_refs) yield c;
          }
        }
      }
    }
  }
}

export function gateA(plan: SitePlan, ctx: ResolveContext): GateAResult {
  const dangling: string[] = [];
  const placedCellRefs = new Set<string>();

  for (const ref of planRefs(plan)) {
    if (!refResolves(ref, ctx)) dangling.push(ref);
  }

  // Coverage: which source cells did the rendered tables place? A table ref in
  // the plan places every numeric cell of that FinTable.
  const placedTableIds = new Set<string>();
  for (const page of plan.pages) {
    for (const instances of Object.values(page.regions)) {
      for (const inst of instances) {
        for (const value of Object.values(inst.slots)) {
          if (typeof value === "string" && value.startsWith("doc:")) placedTableIds.add(value);
        }
      }
    }
  }
  for (const table of ctx.docModel.tables) {
    if (placedTableIds.has(table.id)) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          if (cell.kind === "number") placedCellRefs.add(cell.src_ref);
        }
      }
    }
  }

  const missing: string[] = [];
  let mustAppear = 0;
  for (const table of ctx.docModel.tables) {
    if (!table.must_appear) continue;
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (cell.kind !== "number") continue;
        mustAppear++;
        if (!placedCellRefs.has(cell.src_ref)) missing.push(cell.src_ref);
      }
    }
  }

  const status: "pass" | "fail" =
    dangling.length === 0 && missing.length === 0 ? "pass" : "fail";
  return {
    status,
    dangling_refs: dangling,
    coverage: { must_appear_cells: mustAppear, placed: placedCellRefs.size, missing },
  };
}
