// Αποθήκευση αρχείων για όλη την εφαρμογή: ένα σημείο για ανέβασμα, διαγραφή, λήψη και έλεγχο πρόσβασης.
// Χρήση σε οθόνη: <Files orgId category refType refId /> (components/files.tsx). Από script: saveFile(...).
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { orgPermissionsOf, platformCan } from "../permissions";
import type { getUser } from "../auth";
import { cdnUrl, put, remove } from "./bunny";
import { CATEGORIES, type Category, check, pathFor, platformNeeds } from "./rules";

type User = NonNullable<Awaited<ReturnType<typeof getUser>>>;

/**
 * Μπορεί ο χρήστης να δει και να αλλάξει αρχεία αυτού του είδους, αυτού του πελάτη;
 * Προσωπικό πλατφόρμας: με το δικαίωμα αρχικοποίησης (ή ρυθμίσεων, για αρχεία της πλατφόρμας).
 * Χρήστης πελάτη: μόνο στη ΔΙΚΗ του επιχείρηση και μόνο με το δικαίωμα του είδους.
 */
export function canAccess(user: User, orgId: string | null, category: Category, write = true) {
  if (CATEGORIES[category].platform !== (orgId === null)) return false; // αρχεία πλατφόρμας δεν ανήκουν σε πελάτη, και το αντίστροφο
  const c = CATEGORIES[category];
  if (platformCan(user, "staff" in c && c.staff ? c.staff : platformNeeds(orgId))) return true;
  const m = user.memberships.find((x) => x.orgId === orgId);
  if (!m) return false;
  const needed = !write && "read" in c ? c.read : c.needs;
  return needed == null || orgPermissionsOf(m.role).includes(needed);
}

export class FileError extends Error {}

/** Ελέγχει, ανεβάζει στο Bunny στον φάκελο του πελάτη και καταγράφει. Σε είδη «ενός αρχείου» σβήνει το προηγούμενο. */
export async function saveFile(input: { orgId: string | null; category: Category; refType?: string | null; refId?: string | null; name: string; data: Uint8Array; userId?: string | null }) {
  const verdict = check(input.category, input.data.byteLength, input.data.subarray(0, 16));
  if (!verdict.ok) throw new FileError(verdict.error);
  const c = CATEGORIES[input.category];
  const path = pathFor(input.orgId, input.category, randomBytes(9).toString("base64url"), input.name);
  const ref = { refType: input.refType || null, refId: input.refId || null };
  await put(path, input.data, verdict.contentType);
  const file = await db.storedFile
    .create({ data: { orgId: input.orgId, category: input.category, ...ref, path, name: input.name.slice(0, 200), contentType: verdict.contentType, size: input.data.byteLength, public: c.public, uploadedById: input.userId ?? null } })
    .catch(async (e) => {
      await remove(path).catch(() => {}); // η βάση δεν το κατέγραψε: να μη μείνει ορφανό στο Bunny
      throw e;
    });
  if ("single" in c && c.single) {
    // Μόνο τα ΠΑΛΑΙΟΤΕΡΑ: αν δύο ανεβάσματα τρέξουν μαζί, μένει το νεότερο (αλλιώς το καθένα θα έσβηνε το άλλο).
    // Το νέο αρχείο έχει ήδη αποθηκευτεί: αν το καθάρισμα ενός παλιού αποτύχει, δεν ακυρώνει το ανέβασμα.
    const older = await db.storedFile.findMany({ where: { orgId: input.orgId, category: input.category, ...ref, id: { not: file.id }, createdAt: { lte: file.createdAt } } });
    for (const old of older) await deleteFile(old).catch((e) => console.error("old file cleanup", old.path, e));
  }
  return file;
}

/** Πρώτα από το Bunny, μετά από τη βάση: αν το Bunny αποτύχει, το αρχείο μένει ορατό και η διαγραφή ξαναδοκιμάζεται. */
export async function deleteFile(file: { id: string; path: string }) {
  await remove(file.path);
  await db.storedFile.deleteMany({ where: { id: file.id } }); // deleteMany: αν το έσβησε ήδη άλλο αίτημα, δεν είναι λάθος
}

/** Πού το βρίσκει ο browser: δημόσια από το CDN, ιδιωτικά μέσα από την εφαρμογή (με έλεγχο πρόσβασης). */
export const fileUrl = async (file: { id: string; path: string; public: boolean }) => (file.public ? await cdnUrl(file.path) : null) ?? `/api/files/${file.id}`;

export const listFiles = (where: { orgId: string | null; category: Category; refType?: string | null; refId?: string | null }) =>
  db.storedFile.findMany({ where: { orgId: where.orgId, category: where.category, refType: where.refType ?? null, refId: where.refId ?? null }, orderBy: { createdAt: "desc" }, take: 200 });
