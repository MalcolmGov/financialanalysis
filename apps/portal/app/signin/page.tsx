import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "../../auth";
import { classifyHost, hostOperatorCopy, RAILWAY_PIPELINE_URL } from "../../lib/runtime-host";

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Incorrect email or password.",
  AccessDenied: "That account isn't authorized for this operator console.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "Sign in failed.") : null;
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const hostCopy = hostOperatorCopy(classifyHost(host));
  const uiPreview = hostCopy.kind === "ui-preview";

  return (
    <div className="rs-signin">
      <div className="rs-signin-card">
        <div>
          <p className="rs-kicker">Operator access · {hostCopy.label}</p>
          <h1>Results Studio</h1>
          <p className="rs-lede">
            Sign in to run PDF → DNA → site draft → export. Accounts are provisioned by an
            administrator.
          </p>
          {uiPreview ? (
            <p className="rs-lede" style={{ marginTop: 10 }}>
              This Vercel host is UI-only. Extraction and rebuild run on{" "}
              <a href={RAILWAY_PIPELINE_URL}>the Railway pipeline</a> — use that URL for
              daily production.
            </p>
          ) : (
            <p className="rs-lede" style={{ marginTop: 10 }}>
              {hostCopy.hint}
            </p>
          )}
        </div>
        {errorMessage ? <p className="rs-error">{errorMessage}</p> : null}
        <form
          action={async (formData) => {
            "use server";
            try {
              await signIn("credentials", {
                email: formData.get("email") as string,
                password: formData.get("password") as string,
                redirectTo: "/",
              });
            } catch (err) {
              if (err instanceof AuthError) {
                const type = err.type ?? "CredentialsSignin";
                const { redirect } = await import("next/navigation");
                redirect(`/signin?error=${type}`);
              }
              throw err;
            }
          }}
        >
          <label className="rs-tiny" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="rs-field"
          />
          <label className="rs-tiny" htmlFor="password" style={{ marginTop: 10 }}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className="rs-field"
          />
          <button type="submit" className="rs-btn rs-btn--primary" style={{ marginTop: 18 }}>
            Enter console
          </button>
        </form>
      </div>
    </div>
  );
}
