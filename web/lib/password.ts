import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString("base64")}.${scryptSync(password, salt, 64).toString("base64")}`;
}
export function verifyPassword(password: string, stored: string | null) {
  const [salt, hash] = (stored ?? "").split(".");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
