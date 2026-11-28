// Κανόνες αποθήκευσης αρχείων (χωρίς βάση και δίκτυο, για να ελέγχονται με tests).
// Κάθε πελάτης έχει τον δικό του φάκελο στο Bunny: orgs/<id επιχείρησης>/<είδος>/<τυχαίο>-<όνομα>.
// Ό,τι ανήκει στην πλατφόρμα (π.χ. αντίγραφα ασφαλείας) πάει στο platform/<είδος>/.
import type { Permission, PlatformPermission } from "../permissions.ts";

const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const MB = 1024 * 1024;

/**
 * Τα είδη αρχείων. `public`: σερβίρεται απευθείας από το CDN (φωτογραφίες, λογότυπα). Αλλιώς κατεβαίνει μόνο
 * μέσα από την εφαρμογή, με έλεγχο δικαιώματος. `platform`: ανήκει στην πλατφόρμα, όχι σε πελάτη. `needs`: τι δικαίωμα θέλει ο χρήστης του πελάτη για να ανεβάσει ή να σβήσει (null = κάθε μέλος της επιχείρησης).
 * Νέο είδος = μία γραμμή εδώ.
 */
export const CATEGORIES = {
  logo: { label: "Λογότυπο", public: true, types: IMAGES, maxBytes: 2 * MB, needs: "users.edit", platform: false, single: true },
  photo: { label: "Φωτογραφίες", public: true, types: IMAGES, maxBytes: 8 * MB, needs: "devices.edit", platform: false },
  document: { label: "Έγγραφα", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 20 * MB, needs: "users.edit", platform: false },
  customer_document: { label: "Έγγραφα πελάτη", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 20 * MB, needs: "parties.edit", platform: false },
  purchase_document: { label: "Παραστατικά αγοράς", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 20 * MB, needs: "purchases.edit", read: "purchases.read", platform: false },
  expense_document: { label: "Παραστατικά εξόδων", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 20 * MB, needs: "finance.edit", read: "finance.read", platform: false },
  generated_purchase_order: { label: "PDF παραγγελίας", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "orders.read", platform: false },
  generated_production: { label: "PDF παρτίδας", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "production.read", platform: false },
  generated_recipe: { label: "PDF συνταγής", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "recipes.read", platform: false },
  generated_haccp: { label: "PDF HACCP", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "haccp.read", platform: false },
  generated_sales_document: { label: "PDF παραστατικού πώλησης", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "invoices.read", platform: false },
  generated_schedule: { label: "PDF προγράμματος", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "staff.read", platform: false },
  generated_wholesale_quote: { label: "PDF προσφοράς χονδρικής", public: false, types: ["application/pdf"], maxBytes: 20 * MB, needs: "wholesale.read", platform: false },
  ticket_attachment: { label: "Συνημμένα αιτήματος", public: false, types: [...IMAGES, "application/pdf"], maxBytes: 10 * MB, needs: null, platform: false, staff: "support.tickets" },
  backup: { label: "Αντίγραφα ασφαλείας", public: false, types: ["application/octet-stream"], maxBytes: 5 * 1024 * MB, needs: "users.edit", platform: true },
  trade_item: { label: "Φωτογραφίες ειδών", public: true, types: IMAGES, maxBytes: 4 * MB, needs: null, platform: true },
  manufacturer_logo: { label: "Λογότυπα κατασκευαστών", public: true, types: IMAGES, maxBytes: 2 * MB, needs: null, platform: true, single: true },
} as const satisfies Record<string, { label: string; public: boolean; types: readonly string[]; maxBytes: number; needs: Permission | null; /** ξεχωριστό δικαίωμα μόνο για προβολή/λήψη */ read?: Permission; platform: boolean; /** κρατιέται μόνο το τελευταίο */ single?: boolean; /** ποιο δικαίωμα προσωπικού πλατφόρμας αρκεί (αλλιώς: αρχικοποίηση) */ staff?: PlatformPermission }>;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (v: unknown): v is Category => typeof v === "string" && v in CATEGORIES;
/** Δικαίωμα προσωπικού πλατφόρμας: αρχεία πελάτη = αρχικοποίηση, αρχεία πλατφόρμας = ρυθμίσεις. */
export const platformNeeds = (orgId: string | null): PlatformPermission => (orgId ? "setup.edit" : "settings.edit");

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
