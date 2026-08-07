import { requireOperator } from "../../../../lib/authz";
import { loadAdminOverview } from "../../../../lib/admin-data";

export async function GET(): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }

  try {
    const overview = await loadAdminOverview();
    return Response.json(overview);
  } catch (err) {
    console.error("[api/admin/overview]", err);
    return Response.json({ error: "failed to load admin overview" }, { status: 500 });
  }
}
