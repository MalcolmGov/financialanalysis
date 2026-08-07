import { auth } from "../auth";
import { env } from "../lib/env";

/**
 * Header nav for authenticated operators. Admin uses the same operator
 * allowlist as Projects — there is no separate admin role yet.
 */
export async function ShellNav() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() ?? null;
  const allow = env.OPERATOR_EMAILS;
  const authorized = !!email && (allow.length === 0 || allow.includes(email));
  if (!authorized) {
    return <span className="rs-header-meta">Verified interactive results</span>;
  }

  return (
    <nav className="rs-nav" aria-label="Operator">
      <a href="/" className="rs-nav-link">
        Projects
      </a>
      <a href="/admin" className="rs-nav-link">
        Admin
      </a>
    </nav>
  );
}
