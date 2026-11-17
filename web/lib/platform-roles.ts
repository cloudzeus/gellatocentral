// Τα δικαιώματα των ρόλων προσωπικού όπως τα όρισε ο Super Admin (πίνακας Setting, ένα JSON).
import { db } from "./db";
import { applyPlatformOverrides, parsePlatformOverrides, type PlatformOverrides } from "./permissions";

const KEY = "PLATFORM_ROLE_PERMISSIONS";
let at = 0;
/** Φορτώνει τις αλλαγές στη μνήμη, το πολύ κάθε 5″. Καλείται από το getUser, πριν από κάθε έλεγχο δικαιώματος. */
export async function loadPlatformRoles() {
  if (Date.now() - at < 5000) return;
  applyPlatformOverrides(parsePlatformOverrides((await db.setting.findUnique({ where: { key: KEY } }))?.value));
  at = Date.now();
}
export async function savePlatformRoles(next: PlatformOverrides) {
  const value = JSON.stringify(next);
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  applyPlatformOverrides(next);
  at = Date.now();
}
export const storedPlatformRoles = async () => parsePlatformOverrides((await db.setting.findUnique({ where: { key: KEY } }))?.value);
