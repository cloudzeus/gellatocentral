// Οι ενότητες της εφαρμογής που ανοίγει ή κλείνει ένα πακέτο συνδρομής. Κάθε ενότητα δένει με δικαιώματα και σελίδες.
// Ό,τι ΔΕΝ είναι εδώ (συνδρομή, χρήστες, GDPR, βοήθεια, υποστήριξη, ο λογαριασμός μου) είναι πάντα ανοιχτό.
import type { Permission } from "./permissions";

export const MODULES = {
  dashboard: { label: "Πίνακας ελέγχου", hint: "Πωλήσεις και εικόνα της επιχείρησης", permissions: ["dashboard.view"], paths: ["/"] },
  pos: { label: "Ταμείο και συσκευές", hint: "Έκδοση αποδείξεων, ταμεία, εκτυπωτές, ψυγεία", permissions: ["pos.use", "devices.manage"], paths: ["/pos", "/devices"] },
  receipts: { label: "Αποδείξεις", hint: "Προβολή και επανεκτύπωση όσων έχουν εκδοθεί", permissions: ["receipts.view"], paths: ["/receipts"] },
  customers: { label: "Συναλλασσόμενοι", hint: "Πελάτες, προμηθευτές, franchisees, συνεργάτες: καρτέλες, αρχεία και συναινέσεις", permissions: ["customers.manage"], paths: ["/parties", "/customers"] },
  recipes: { label: "Συνταγολόγιο", hint: "Α΄ ύλες, συνταγές, προϊόντα", permissions: [], paths: ["/materials", "/recipes", "/products"] },
  production: { label: "Παραγωγή", hint: "Παραγωγή, HACCP, ιχνηλασιμότητα", permissions: [], paths: ["/production", "/haccp", "/traceability"] },
  inventory: { label: "Αποθήκη και αγορές", hint: "Αποθήκη, απογραφές, παραγγελίες υλών", permissions: [], paths: ["/inventory", "/counts", "/orders"] },
  wholesale: { label: "Χονδρική", hint: "Παραγγελίες πελατών, παραστατικά, βιτρίνα", permissions: [], paths: ["/wholesale-orders", "/invoices", "/vitrine"] },
  team: { label: "Ομάδα και αναφορές", hint: "Προσωπικό, βάρδιες, αναφορές", permissions: [], paths: ["/staff", "/reports"] },
  finance: { label: "Οικονομικά", hint: "Έσοδα, έξοδα, ταμειακή εικόνα", permissions: [], paths: ["/finance"] },
} as const satisfies Record<string, { label: string; hint: string; permissions: readonly Permission[]; paths: readonly string[] }>;
export type ModuleKey = keyof typeof MODULES;
export const ALL_MODULES = Object.keys(MODULES) as ModuleKey[];
export const isModule = (v: unknown): v is ModuleKey => typeof v === "string" && v in MODULES;

const entries = Object.entries(MODULES) as [ModuleKey, (typeof MODULES)[ModuleKey]][];
/** Σε ποια ενότητα ανήκει ένα δικαίωμα ή μια σελίδα· null = πάντα ανοιχτό. */
export const moduleOfPermission = (p: string): ModuleKey | null => entries.find(([, m]) => (m.permissions as readonly string[]).includes(p))?.[0] ?? null;
export const moduleOfPath = (path: string): ModuleKey | null => entries.find(([, m]) => m.paths.some((x) => (x === "/" ? path === "/" : path === x || path.startsWith(`${x}/`))))?.[0] ?? null;

/** Τα δικαιώματα του ρόλου που μένουν αφού κλείσουν όσες ενότητες δεν έχει το πακέτο (ή η παύση). */
export const allowedPermissions = (rolePermissions: readonly string[], open: readonly string[]) => rolePermissions.filter((p) => { const m = moduleOfPermission(p); return m === null || open.includes(m); });
export const pathOpen = (path: string, open: readonly string[]) => { const m = moduleOfPath(path); return m === null || open.includes(m); };
