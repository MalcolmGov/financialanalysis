/**
 * Quick verify of polish CSS on a blob key.
 * Usage: BLOB_READ_WRITE_TOKEN=... npx tsx scripts/verify-polish-layout.ts <blobKey>
 */
import { getPrivate } from "../lib/blob";

async function main() {
  const key = process.argv[2] ?? "runs/ac1f2982-02f9-4002-94be-e85b1ad44518/prototypes/v4/assembled.html";
  const html = (await getPrivate(key)).toString("utf8");
  const polish = html.match(/<style data-rs-readable="1">([\s\S]*?)<\/style>/)?.[1] ?? "";
  const checks = {
    hasPolish: polish.length > 0,
    bodyOverflowHidden: /html,body\{\s*overflow-x:hidden/.test(polish),
    navUlSelector: polish.includes(".nav ul"),
    navASelector: polish.includes(".nav a"),
    navUlFlexWrap: polish.includes("flex-wrap:wrap!important"),
    navUlOverflowVisible: polish.includes("overflow-x:visible!important"),
    navAWhiteSpaceNormal: polish.includes("white-space:normal!important"),
    marginInlineAuto: polish.includes("margin-inline:auto"),
    operatingSegmentsLink: html.includes('href="#segments">Operating segments'),
    origNavCssBeforePolish:
      html.indexOf(".nav ul{list-style:none;display:flex") < html.indexOf('data-rs-readable="1"'),
  };
  process.stdout.write(JSON.stringify({ key, checks }, null, 2) + "\n");
  const failed = Object.entries(checks).filter(([, v]) => !v);
  if (failed.length) {
    console.error("FAILED:", failed.map(([k]) => k).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
