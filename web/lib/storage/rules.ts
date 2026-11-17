// Κανόνες αποθήκευσης αρχείων (χωρίς βάση και δίκτυο, για να ελέγχονται με tests).
// Κάθε πελάτης έχει τον δικό του φάκελο στο Bunny: orgs/<id επιχείρησης>/<είδος>/<τυχαίο>-<όνομα>.
// Ό,τι ανήκει στην πλατφόρμα (π.χ. αντίγραφα ασφαλείας) πάει στο platform/<είδος>/.
import type { Permission, PlatformPermission } from "../permissions.ts";

const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const MB = 1024 * 1024;

/**
 * Τα είδη αρχείων. `public`: σερβίρεται απευθείας από το CDN (φωτογραφίες, λογότυπα). Αλλιώς κατεβαίνει μόνο
 * μέσα από την εφαρμογή, με έλεγχο δικαιώματος. `platform`: ανήκει στην πλατφόρμα, όχι σε πελάτη. `needs`: τι δικαίωμα θέλει ο χρήστης του πελάτη για να ανεβάσει ή να σβήσει.
 * Νέο είδος = μία γραμμή εδώ.
 */
export const CATEGORIES = {
  logo: { label: "Λογότυπο", public: true, types: IMAGES, maxBytes: 2 * MB, needs: "users.manage", platform: false, single: true },
  photo: { label: "Φωτογραφίες", public: true, types: IMAGES, maxBytes: 8 * MB, needs: "devices.manage", platform: false },
  document: { label: "Έγγραφα", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 20 * MB, needs: "users.manage", platform: false },
  customer_document: { label: "Έγγραφα πελάτη", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 20 * MB, needs: "customers.manage", platform: false },
  backup: { label: "Αντίγραφα ασφαλείας", public: false, types: ["application/octet-stream"], maxBytes: 5 * 1024 * MB, needs: "users.manage", platform: true },
} as const satisfies Record<string, { label: string; public: boolean; types: readonly string[]; maxBytes: number; needs: Permission; platform: boolean; /** κρατιέται μόνο το τελευταίο */ single?: boolean }>;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (v: unknown): v is Category => typeof v === "string" && v in CATEGORIES;
/** Δικαίωμα προσωπικού πλατφόρμας: αρχεία πελάτη = αρχικοποίηση, αρχεία πλατφόρμας = ρυθμίσεις. */
export const platformNeeds = (orgId: string | null): PlatformPermission => (orgId ? "setup.manage" : "settings.manage");

/**
 * Όνομα αρχείου ασφαλές για διαδρομή: μόνο λατινικά, ψηφία, τελεία, παύλα· χωρίς φακέλους, χωρίς κρυφά ονόματα.
 * Ό,τι δεν είναι λατινικό (π.χ. ελληνικά) φεύγει· η κατάληξη μένει. Το αρχικό όνομα φυλάσσεται στη βάση για εμφάνιση.
 */
export function safeName(name: string) {
  const last = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[\\/]/).pop() ?? "";
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(last)?.[1];
  const base = (ext ? last.slice(0, -ext.length - 1) : last).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(-60);
  return `${base || "file"}${ext ? `.${ext.toLowerCase()}` : ""}`;
}

/** Ο φάκελος ενός πελάτη (ή της πλατφόρμας). Όλα τα αρχεία του ζουν από εδώ και κάτω. */
export const folderFor = (orgId: string | null) => (orgId ? `orgs/${orgId}` : "platform");
export const pathFor = (orgId: string | null, category: Category, unique: string, name: string) => `${folderFor(orgId)}/${category}/${unique}-${safeName(name)}`;

const SIGNATURES: [type: string, test: (b: Uint8Array) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["image/webp", (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP"],
  ["image/avif", (b) => ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12))],
  ["application/pdf", (b) => ascii(b, 0, 5) === "%PDF-"],
];
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));
/** Ο πραγματικός τύπος από τα πρώτα bytes. Δεν εμπιστευόμαστε ό,τι δηλώνει ο browser ή η κατάληξη. */
export const sniff = (head: Uint8Array) => SIGNATURES.find(([, test]) => test(head))?.[0] ?? null;

/** Ελέγχει μέγεθος και τύπο για το είδος. Επιστρέφει τον τύπο που θα αποθηκευτεί, ή μήνυμα λάθους για τον χρήστη. */
export function check(category: Category, size: number, head: Uint8Array): { ok: true; contentType: string } | { ok: false; error: string } {
  const c = CATEGORIES[category];
  if (size <= 0) return { ok: false, error: "Το αρχείο είναι άδειο" };
  if (size > c.maxBytes) return { ok: false, error: `Το αρχείο είναι μεγαλύτερο από ${Math.round(c.maxBytes / MB)} MB` };
  // τα αντίγραφα ασφαλείας δεν έχουν αναγνωρίσιμη υπογραφή· τα ανεβάζει μόνο ο server
  const type = category === "backup" ? "application/octet-stream" : sniff(head);
  if (!type || !(c.types as readonly string[]).includes(type)) return { ok: false, error: `Δεν επιτρέπεται αυτός ο τύπος αρχείου. Δεκτά: ${c.types.map((t) => t.split("/")[1].toUpperCase()).join(", ")}` };
  return { ok: true, contentType: type };
}

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < MB ? `${Math.round(n / 1024)} KB` : `${(n / MB).toFixed(1).replace(".", ",")} MB`);
