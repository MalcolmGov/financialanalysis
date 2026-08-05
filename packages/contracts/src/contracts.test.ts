import { describe, expect, it } from "vitest";
import {
  Blueprint,
  cellRef,
  ExtractionResult,
  NoNumeralsText,
  NumericSlotRef,
  parseCellRef,
  SitePlan,
  validateSitePlan,
} from "./index.js";

const sha = "a".repeat(64);

const miniExtraction = {
  schema_version: "1.0",
  extraction_id: "ext_1",
  org_id: "org_1",
  project_id: "prj_1",
  source: {
    blob_path: "orgs/org_1/projects/prj_1/source/upl_1/original.pdf",
    sha256: sha,
    size_bytes: 2_600_000,
    page_count: 10,
    pdf_meta: { title: "DRD", producer: "Workiva", created: "", modified: "" },
  },
  engine: {
    docling_version: "2.70.0",
    backend: "docling_parse_v4",
    table_mode: "accurate",
    ocr_applied: false,
    ocr_engine: null,
  },
  pages: [
    {
      page_no: 1,
      width_pt: 595.3,
      height_pt: 841.9,
      image: {
        blob_path: "pages/p001@2x.png",
        width_px: 1191,
        height_px: 1684,
        scale: 2,
        px_per_pt: 2,
      },
    },
  ],
  body: [
    {
      id: "blk-1",
      type: "heading",
      level: 1,
      text: "Highlights",
      prov: [{ page_no: 1, bbox: { l: 36, t: 200, r: 559, b: 220 } }],
      children: [
        {
          id: "blk-2",
          type: "paragraph",
          text: "Operating profit increased by 72% to R2 712.8 million",
          prov: [{ page_no: 1, bbox: { l: 36, t: 230, r: 300, b: 260 } }],
          children: [],
        },
      ],
    },
  ],
  furniture: [],
  tables: {
    "tbl-1": {
      id: "tbl-1",
      caption_block: null,
      prov: [{ page_no: 1, bbox: { l: 36, t: 430, r: 559, b: 700 } }],
      num_rows: 2,
      num_cols: 2,
      cells: [
        { r: 0, c: 0, row_span: 1, col_span: 1, text: "Revenue", is_col_header: false, is_row_header: true, is_section: false },
        { r: 0, c: 1, row_span: 1, col_span: 1, text: "5 053.2", is_col_header: false, is_row_header: false, is_section: false },
      ],
      column_roles: null,
    },
  },
  figures: {},
  warnings: [],
  enrichment: { sections: [], key_figures: [], numeric_annotations: {} },
};

describe("ExtractionResult", () => {
  it("parses a minimal valid document with recursive blocks", () => {
    const parsed = ExtractionResult.parse(miniExtraction);
    expect(parsed.body[0].children[0].text).toContain("R2 712.8");
    // verbatim: value must be exactly the source string, whitespace intact
    expect(parsed.tables["tbl-1"].cells[1].text).toBe("5 053.2");
  });
});

describe("ref schemes", () => {
  it("round-trips cell refs", () => {
    const ref = cellRef("tbl-1", 3, 2);
    expect(ref).toBe("ext:tbl-1:r3c2");
    expect(parseCellRef(ref)).toEqual({ table_id: "tbl-1", row: 3, col: 2 });
  });
  it("numeric slots refuse literals", () => {
    expect(NumericSlotRef.safeParse("ext:tbl-1:r3c2").success).toBe(true);
    expect(NumericSlotRef.safeParse("doc:tbl_pnl").success).toBe(true);
    expect(NumericSlotRef.safeParse("2712.8").success).toBe(false);
    expect(NumericSlotRef.safeParse("R2 712.8 million").success).toBe(false);
  });
  it("microcopy fence refuses numerals", () => {
    expect(NoNumeralsText.safeParse("Results overview").success).toBe(true);
    expect(NoNumeralsText.safeParse("Up 72% this period").success).toBe(false);
  });
});

const blueprint = Blueprint.parse({
  schema_version: "1.0",
  blueprint_version_id: "bpv_1",
  project_id: "prj_1",
  cycle: 1,
  source_prototype_version_id: "pv_5",
  source_prototype_sha256: sha,
  status: "locked",
  locked_at: "2026-08-05T14:00:00Z",
  locked_by: "usr_1",
  checksum: sha,
  tokens: { css: ":root{--dna-brand:#B8912A;}", values: { "color.brand": "#B8912A" } },
  typography: { font_faces: [], ramp: [] },
  breakpoints: [{ name: "mobile", min_width: null, max_width: 479 }],
  navigation: { model: "sticky-top", items: [] },
  page_templates: [
    {
      id: "bp:tpl_cover",
      name: "Cover",
      shell_html: "<main>{{region:kpis}}</main>",
      regions: [{ id: "kpis", accepts: ["bp:cmp_KpiCard"], min: 1, max: 6 }],
    },
  ],
  components: [
    {
      id: "bp:cmp_KpiCard",
      name: "KPI Card",
      html: '<div class="kpi"><span>{{slot:value}}</span><span>{{slot:label}}</span></div>',
      css: ".kpi{border-top:3px solid var(--dna-brand)}",
      slots: {
        label: { type: "text", no_numerals: true, max_chars: 60, required: true },
        value: { type: "ref", accepts: "cell", required: true },
      },
      variants: ["accent"],
    },
  ],
  table_styles: {
    header_bg: "color.table-head-bg",
    header_fg: "color.table-head-fg",
    current_period_shade: null,
    numeric_alignment: "right",
    zebra: false,
    rule_style: "hairline",
    negative_number_style: "parens",
    number_grouping: "space",
  },
  chart_theme: {
    palette: ["color.brand"],
    grid_color: "color.rule",
    font_role: "body",
    number_format: { locale: "en-ZA", thousands: " " },
    allowed_chart_kinds: ["groupedBar"],
  },
  print_stylesheet: null,
  a11y: { approved_text_pairs: [{ fg: "#231F20", bg: "#FFFFFF", ratio: 14.9 }] },
  assets: [],
  usage_rules: [],
});

const validPlan = {
  schema_version: "siteplan/1",
  site_plan_id: "sp_1",
  doc_model_id: "dm_1",
  blueprint_version_id: "bpv_1",
  blueprint_checksum: sha,
  model: "claude-sonnet-5",
  iteration: 1,
  nav: [{ label: "Overview", href: "index.html" }],
  pages: [
    {
      path: "index.html",
      template: "bp:tpl_cover",
      title: "Overview",
      regions: {
        kpis: [
          {
            component: "bp:cmp_KpiCard",
            variant: "accent",
            slots: { label: "Operating profit", value: "ext:tbl-1:r0c1" },
          },
        ],
      },
      downloads: [],
    },
  ],
  validation: { status: "unvalidated", errors: [] },
};

describe("validateSitePlan", () => {
  it("accepts a conforming ref-only plan", () => {
    const plan = SitePlan.parse(validPlan);
    expect(validateSitePlan(plan, blueprint)).toEqual([]);
  });

  it("rejects a numeric literal in a ref slot", () => {
    const bad = structuredClone(validPlan);
    bad.pages[0].regions.kpis[0].slots.value = "2 712.8";
    const violations = validateSitePlan(SitePlan.parse(bad), blueprint);
    expect(violations.some((v) => v.rule === "ref-required")).toBe(true);
  });

  it("rejects numerals smuggled into microcopy", () => {
    const bad = structuredClone(validPlan);
    bad.pages[0].regions.kpis[0].slots.label = "Operating profit up 72%";
    const violations = validateSitePlan(SitePlan.parse(bad), blueprint);
    expect(violations.some((v) => v.rule === "microcopy-numeral")).toBe(true);
  });

  it("rejects components not in the blueprint inventory", () => {
    const bad = structuredClone(validPlan);
    bad.pages[0].regions.kpis[0].component = "bp:cmp_InventedHero";
    const violations = validateSitePlan(SitePlan.parse(bad), blueprint);
    expect(violations.some((v) => v.rule === "unknown-component")).toBe(true);
  });

  it("rejects a plan pinned to a different blueprint checksum", () => {
    const bad = structuredClone(validPlan);
    bad.blueprint_checksum = "b".repeat(64);
    const violations = validateSitePlan(SitePlan.parse(bad), blueprint);
    expect(violations.some((v) => v.rule === "blueprint-checksum")).toBe(true);
  });
});
