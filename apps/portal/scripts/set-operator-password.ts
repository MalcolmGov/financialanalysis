/**
 * Provision or update an operator's login password. There is no self-serve
 * signup — this is the only way an account gets a password.
 *
 * Run: pnpm exec tsx scripts/set-operator-password.ts <email>
 * The password is prompted for (masked) instead of taken as an argument, so
 * it never lands in `ps`/process-list output or shell history. Non-TTY stdin
 * (e.g. `printf 'pw\n' | tsx ...`) also works, just without masking.
 */
import { createInterface } from "node:readline";
import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { assertStrongPassword, hashPassword } from "../lib/password";

function promptPassword(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // @ts-expect-error - readline has no public API for masked input
    rl._writeToOutput = (str: string) => {
      if (!muted) process.stdout.write(str);
    };
    rl.question(query, (value) => {
      rl.close();
      process.stdout.write("\n");
      resolve(value);
    });
    muted = true;
  });
}

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: set-operator-password.ts <email>");
    process.exit(1);
  }
  const password = await promptPassword("Password: ");
  assertStrongPassword(password);
  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = hashPassword(password);

  const [existing] = await db().select().from(schema.users).where(eq(schema.users.email, normalizedEmail));
  if (existing) {
    await db().update(schema.users).set({ passwordHash }).where(eq(schema.users.id, existing.id));
    console.log(`Updated password for existing operator ${normalizedEmail}.`);
  } else {
    await db().insert(schema.users).values({ email: normalizedEmail, passwordHash });
    console.log(`Created operator ${normalizedEmail}.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
