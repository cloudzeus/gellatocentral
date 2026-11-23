// Ανέβασμα αρχείου: ο browser στέλνει εδώ, ο server ελέγχει πρόσβαση και περιεχόμενο και το προωθεί στο Bunny.
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess, FileError, saveFile } from "@/lib/storage";
import { storageConfigured } from "@/lib/storage/bunny";
import { CATEGORIES, isCategory } from "@/lib/storage/rules";

const fail = (status: number, error: string) => Response.json({ error }, { status });
const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v ? v.slice(0, 80) : null);

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return fail(401, "Χρειάζεται σύνδεση");
  // μόνο από τη δική μας σελίδα (το cookie είναι SameSite=Lax· αυτός είναι ο δεύτερος έλεγχος)
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return fail(403, "Μη αποδεκτή προέλευση");
  if (!(await storageConfigured())) return fail(503, "Δεν έχει οριστεί αποθήκευση αρχείων στον server");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const category = form?.get("category");
  if (!form || !(file instanceof File) || !isCategory(category)) return fail(400, "Λείπει το αρχείο ή το είδος του");
  const orgId = text(form.get("orgId"));
  if (!canAccess(user, orgId, category)) return fail(403, "Δεν έχεις δικαίωμα να ανεβάσεις εδώ");
  if (file.size > CATEGORIES[category].maxBytes) return fail(413, `Το αρχείο είναι μεγαλύτερο από ${Math.round(CATEGORIES[category].maxBytes / 1048576)} MB`);
  const refType = text(form.get("refType"));
  const refId = text(form.get("refId"));
  if (category === "purchase_document") {
    const doc = refType === "purchase" && refId && orgId ? await db.purchaseDoc.findFirst({ where: { id: refId, orgId, status: "DRAFT" }, select: { id: true } }) : null;
    if (!doc) return fail(409, "Το πρόχειρο παραστατικό δεν βρέθηκε ή έχει ήδη καταχωρηθεί");
  }

  try {
    const saved = await saveFile({ orgId, category, refType, refId, name: file.name, data: new Uint8Array(await file.arrayBuffer()), userId: user.id });
    return Response.json({ id: saved.id });
  } catch (e) {
    if (e instanceof FileError) return fail(400, e.message);
    console.error("file upload", e);
    return fail(502, "Η αποθήκευση απέτυχε. Δοκίμασε ξανά");
  }
}
