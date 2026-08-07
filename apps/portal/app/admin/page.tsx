import { requireOperatorOrRedirect } from "../../lib/authz";
import { loadAdminOverview } from "../../lib/admin-data";
import { AdminDashboard } from "./admin-dashboard";

export default async function AdminPage() {
  await requireOperatorOrRedirect();
  const data = await loadAdminOverview();
  return <AdminDashboard data={data} />;
}
