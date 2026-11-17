// RBAC: τα δικαιώματα ορίζονται εδώ (κώδικας)· οι ρόλοι είναι δεδομένα κάθε επιχείρησης και κρατούν μια λίστα από αυτά.
export const PERMISSIONS = [
  { key: "dashboard.view", group: "Επισκόπηση", label: "Πίνακας ελέγχου", hint: "Πωλήσεις ημέρας και ενότητες της επιχείρησης" },
  { key: "pos.use", group: "Ταμείο & τιμολόγηση", label: "Ταμείο", hint: "Έκδοση αποδείξεων" },
  { key: "receipts.view", group: "Ταμείο & τιμολόγηση", label: "Αποδείξεις", hint: "Προβολή και επανεκτύπωση" },
  { key: "devices.manage", group: "Ταμείο & τιμολόγηση", label: "Συσκευές", hint: "Προσθήκη και απενεργοποίηση ταμείων (αλλάζει τη χρέωση)" },
  { key: "customers.manage", group: "Πελάτες & πωλήσεις", label: "Πελάτες", hint: "Καρτέλες πελατών, αρχεία και συναινέσεις τους" },
  { key: "billing.view", group: "Ρυθμίσεις", label: "Συνδρομή", hint: "Το κόστος της συνδρομής" },
  { key: "users.manage", group: "Ρυθμίσεις", label: "Χρήστες & ρόλοι", hint: "Προσκλήσεις, ρόλοι και δικαιώματα" },
  { key: "tickets.manage", group: "Υποστήριξη", label: "Όλα τα αιτήματα", hint: "Βλέπει και απαντά στα αιτήματα υποστήριξης όλης της επιχείρησης (ο καθένας βλέπει πάντα τα δικά του)" },
  { key: "gdpr.manage", group: "Ρυθμίσεις", label: "GDPR & συναινέσεις", hint: "Συναινέσεις, αιτήματα διαγραφής και ημερολόγιο προσωπικών δεδομένων" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key) as Permission[];
export const isPermission = (v: string): v is Permission => (ALL_PERMISSIONS as string[]).includes(v);

/** Ποιο δικαίωμα θέλει κάθε σελίδα. Ό,τι δεν αναφέρεται (ενότητες υπό κατασκευή) θέλει τον πίνακα ελέγχου. */
const PAGE: Record<string, Permission> = { "/pos": "pos.use", "/receipts": "receipts.view", "/devices": "devices.manage", "/billing": "billing.view", "/users": "users.manage", "/gdpr": "gdpr.manage", "/customers": "customers.manage" };
export const permissionFor = (path: string): Permission => PAGE[Object.keys(PAGE).find((p) => path === p || path.startsWith(`${p}/`)) ?? ""] ?? "dashboard.view";

/** Οι τρεις ρόλοι που αποκτά κάθε νέα επιχείρηση. Ο «Επιχειρηματίας» είναι κλειδωμένος: έχει πάντα όλα τα δικαιώματα. */
export const SYSTEM_ROLES: { name: string; permissions: Permission[]; locked: boolean }[] = [
  { name: "Επιχειρηματίας", permissions: ALL_PERMISSIONS, locked: true },
  { name: "Manager", permissions: ["dashboard.view", "pos.use", "receipts.view", "devices.manage", "customers.manage", "tickets.manage"], locked: false },
  { name: "Υπάλληλος", permissions: ["pos.use", "receipts.view"], locked: false },
];

/** Κανείς δεν δίνει δικαίωμα που δεν έχει ο ίδιος (ούτε με ρόλο, ούτε αλλάζοντας έναν ρόλο). */
export const canGrant = (actor: readonly string[], wanted: readonly string[]) => wanted.every((p) => actor.includes(p));

// ---- Προσωπικό της πλατφόρμας (όχι των συνδρομητών). Σταθεροί ρόλοι: ορίζονται εδώ, όχι από οθόνη. ----
export const PLATFORM_PERMISSIONS = {
  "orgs.view": "Βλέπει τους συνδρομητές",
  "orgs.create": "Δημιουργεί επιχειρήσεις",
  "billing.manage": "Συνδρομές και χρεώσεις",
  "setup.manage": "Αρχικοποίηση: στοιχεία, Viva, καταστήματα, αποθήκες, εκτυπωτές, ταμεία",
  "users.manage": "Χρήστες των συνδρομητών",
  "settings.manage": "Ρυθμίσεις πλατφόρμας και email",
  "staff.manage": "Προσωπικό πλατφόρμας",
  "gdpr.manage": "GDPR: συναινέσεις, αιτήματα διαγραφής, ημερολόγιο",
  "support.remote": "Απομακρυσμένη σύνδεση σε συσκευές πελατών",
  "support.tickets": "Αιτήματα υποστήριξης των πελατών",
  "support.kb": "Έγκριση και δημοσίευση άρθρων της βάσης γνώσεων",
} as const;
export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
export type PlatformRoleKey = "SUPER_ADMIN" | "MANAGER" | "STAFF" | "SUPPORT";

export const PLATFORM_ROLES: Record<PlatformRoleKey, { label: string; hint: string; permissions: PlatformPermission[] }> = {
  SUPER_ADMIN: { label: "Super Admin", hint: "Όλα, μαζί με ρυθμίσεις και προσωπικό", permissions: Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[] },
  MANAGER: { label: "Manager", hint: "Συνδρομητές, συνδρομές και αρχικοποίηση", permissions: ["orgs.view", "orgs.create", "billing.manage", "setup.manage", "users.manage", "gdpr.manage", "support.remote", "support.tickets", "support.kb"] },
  STAFF: { label: "Υπάλληλος εφαρμογής", hint: "Αρχικοποίηση συνδρομητών, χωρίς χρεώσεις", permissions: ["orgs.view", "setup.manage", "users.manage", "support.remote", "support.tickets"] },
  SUPPORT: { label: "Υπάλληλος υποστήριξης", hint: "Βλέπει τους συνδρομητές και βοηθά τους χρήστες τους", permissions: ["orgs.view", "users.manage", "support.remote", "support.tickets"] },
};
export const platformCan = (role: PlatformRoleKey | null | undefined, p: PlatformPermission) => !!role && PLATFORM_ROLES[role].permissions.includes(p);
