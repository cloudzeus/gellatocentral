import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { appUrl } from "./mail/send";

export const hashResetToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Νέος σύνδεσμος ορισμού κωδικού. Στη βάση μένει μόνο το sha256· ο σύνδεσμος υπάρχει μόνο μέσα στο email. */
export async function createResetLink(userId: string, hours: number, org?: { slug: string | null } | null) {
  const token = randomBytes(32).toString("base64url");
  await db.passwordReset.create({ data: { userId, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
  return `${await appUrl(org)}/reset?token=${token}`;
}
