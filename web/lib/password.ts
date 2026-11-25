import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString("base64")}.${scryptSync(password, salt, 64).toString("base64")}`;
}
/** Ασύγχρονο: το scrypt κοστίζει δεκάδες ms και το σύγχρονο θα πάγωνε όλο τον server σε κάθε προσπάθεια σύνδεσης. */
export async function verifyPassword(password: string, stored: string | null) {
  const [salt, hash] = (stored ?? "").split(".");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
