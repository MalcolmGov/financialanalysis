import { AuthError } from "next-auth";
import { signIn } from "../../auth";

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

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Sign in</h1>
      <p style={{ color: "var(--ink-2)", margin: 0 }}>
        Operator access only. Accounts are provisioned by an administrator.
      </p>
      {errorMessage ? (
        <p style={{ color: "#b91c1c", margin: 0 }}>{errorMessage}</p>
      ) : null}
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
        style={{ display: "grid", gap: 8 }}
      >
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          style={{
            padding: "10px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "transparent",
            color: "var(--ink)",
          }}
        />
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          style={{
            padding: "10px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "transparent",
            color: "var(--ink)",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "10px 18px",
            border: "none",
            borderRadius: 6,
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
