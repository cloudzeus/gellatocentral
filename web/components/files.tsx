// Αρχεία οποιασδήποτε εγγραφής, αποθηκευμένα στο Bunny. Ένα component για όλη την εφαρμογή:
//
//   <Files orgId={org.id} category="photo" refType="product" refId={product.id} />
//
// Το είδος (lib/storage/rules.ts) ορίζει τι τύποι και τι μέγεθος επιτρέπονται, αν το αρχείο είναι δημόσιο (CDN)
// και ποιο δικαίωμα χρειάζεται. Κάθε πελάτης γράφει μόνο στον δικό του φάκελο· ο έλεγχος γίνεται στον server.
import { getUser } from "@/lib/auth";
import { canAccess, fileUrl, listFiles } from "@/lib/storage";
import { storageConfigured } from "@/lib/storage/bunny";
import { bytes, CATEGORIES, type Category } from "@/lib/storage/rules";
import { FileManager } from "./file-manager";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
const EXT: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP", "image/avif": "AVIF", "application/pdf": "PDF" };

export async function Files({ orgId, category, refType, refId, readOnly = false, empty }: { orgId: string | null; category: Category; refType?: string; refId?: string; readOnly?: boolean; empty?: string }) {
  const user = await getUser();
  if (!user || !canAccess(user, orgId, category, false)) return null;
  const c = CATEGORIES[category];
  const [ready, rows] = await Promise.all([storageConfigured(), listFiles({ orgId, category, refType, refId })]);
  const files = await Promise.all(rows.map(async (f) => ({ id: f.id, name: f.name, size: bytes(f.size), when: when.format(f.createdAt), url: await fileUrl(f), image: f.contentType.startsWith("image/") })));
  return (
    <div className="space-y-3">
      {ready ? null : <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{user.platformRole ? "Η αποθήκευση αρχείων δεν έχει ρυθμιστεί ακόμα. Ορίζεται στις Ρυθμίσεις & email › Bunny" : "Το ανέβασμα αρχείων δεν είναι διαθέσιμο ακόμα"}</p>}
      <FileManager
        orgId={orgId} category={category} refType={refType} refId={refId} files={files}
        accept={c.types.join(",")} multiple={!("single" in c && c.single)} canEdit={ready && !readOnly && canAccess(user, orgId, category)}
        hint={`${c.types.map((t) => EXT[t] ?? t).join(", ")} έως ${bytes(c.maxBytes)}`}
      />
      {files.length === 0 ? <p className="text-sm text-muted-foreground">{empty ?? "Κανένα αρχείο ακόμα"}</p> : null}
    </div>
  );
}
