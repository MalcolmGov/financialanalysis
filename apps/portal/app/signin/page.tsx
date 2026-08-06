import { signIn } from "../../auth";

export default function SignIn() {
  return (
    <div style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Sign in</h1>
      <p style={{ color: "var(--ink-2)", margin: 0 }}>
        Operator access is by magic link. Enter your allowlisted email.
      </p>
      <form
        action={async (formData) => {
          "use server";
          await signIn("resend", { email: formData.get("email") as string });
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
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
          Send magic link
        </button>
      </form>
    </div>
  );
}
