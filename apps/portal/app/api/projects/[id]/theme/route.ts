import { z } from "zod";
import { requireOperator } from "../../../../../lib/authz";
import { env } from "../../../../../lib/env";
import {
  IR_THEME_META,
  IrThemeError,
  loadProjectTheme,
  persistProjectTheme,
} from "../../../../../lib/ir-theme";
import {
  RebuildSiteDraftError,
  rebuildProjectSiteDraft,
} from "../../../../../lib/rebuild-site-draft";

const PutBody = z.object({
  themeId: z.enum(["classic", "editorial"]),
  /** When true (default), rebuild multipage site draft after persist. */
  rebuild: z.boolean().optional().default(true),
});

/** Current IR theme + soft suggestion for the console picker. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  if (env.MOCK_BLOB) {
    return Response.json({ error: "theme unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  try {
    const snap = await loadProjectTheme(projectId);
    return Response.json({
      themeId: snap.themeId,
      suggestedThemeId: snap.suggestedThemeId,
      suggestReason: snap.suggestReason,
      operatorOverride: snap.operatorOverride,
      dnaId: snap.dnaId,
      revision: snap.revision,
      themes: IR_THEME_META,
    });
  } catch (err) {
    if (err instanceof IrThemeError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Persist theme_id on DesignDNA and optionally rebuild the site draft.
 * Does not change extraction numbers — chrome/layout only.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let operator;
  try {
    operator = await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  if (env.MOCK_BLOB) {
    return Response.json({ error: "theme unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  let body: z.infer<typeof PutBody>;
  try {
    body = PutBody.parse(await request.json());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const snap = await persistProjectTheme({
      projectId,
      themeId: body.themeId,
      by: operator.email,
    });

    if (!body.rebuild) {
      return Response.json({
        ok: true,
        themeId: snap.themeId,
        revision: snap.revision,
        rebuilt: false,
        rebuildHint: "Theme saved. Rebuild the multipage site draft to apply it in preview.",
        themes: IR_THEME_META,
      });
    }

    try {
      const draft = await rebuildProjectSiteDraft({
        projectId,
        note: `rebuilt after IR theme → ${snap.themeId} by ${operator.email}`,
        hardFailGates: true,
        // Pass through so render does not depend on blob read-after-write.
        themeId: snap.themeId,
      });
      return Response.json({
        ok: true,
        themeId: snap.themeId,
        revision: snap.revision,
        rebuilt: true,
        draft,
        rebuildHint: `Site draft rebuilt to v${draft.draftVersion} with theme “${snap.themeId}”.`,
        themes: IR_THEME_META,
      });
    } catch (err) {
      if (err instanceof RebuildSiteDraftError) {
        return Response.json(
          {
            ok: true,
            themeId: snap.themeId,
            revision: snap.revision,
            rebuilt: false,
            rebuildError: err.message,
            rebuildDetails: err.details ?? null,
            rebuildHint:
              "Theme saved on DNA, but site draft rebuild failed. Retry rebuild from Site or Brand kit.",
            themes: IR_THEME_META,
          },
          { status: 200 },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof IrThemeError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("theme put failed:", err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
