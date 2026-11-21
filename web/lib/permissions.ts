// RBAC: τα δικαιώματα ορίζονται εδώ (κώδικας)· ρόλοι και ομάδες είναι δεδομένα που κρατούν λίστες από αυτά.
// Κάθε δικαίωμα είναι «περιοχή.ενέργεια»: η περιοχή είναι ενότητα της εφαρμογής (όπως στο μενού) και η ενέργεια
// μία από read / add / edit / delete ή ειδική (pos.use, stores.pause, tickets.manage, support.remote…).
// Το read μιας περιοχής είναι και η είσοδος στην οθόνη της: όποιος παίρνει οποιαδήποτε άλλη ενέργεια της
// περιοχής, παίρνει αυτόματα και το read (βλ. normalize). Τα δικαιώματα του χρήστη είναι η ΕΝΩΣΗ
// ρόλου + ομάδων (+ μεμονωμένων παραχωρήσεων)· δεν υπάρχουν αφαιρέσεις.

export const ACTION_LABEL = {
  read: "Προβολή",
  add: "Προσθήκη",
  edit: "Επεξεργασία",
  delete: "Διαγραφή",
  use: "Χρήση",
  reissue: "Επανεκτύπωση",
  pause: "Εποχιακή παύση",
  manage: "Διαχείριση όλων",
  remote: "Απομακρυσμένη σύνδεση",
  tickets: "Αιτήματα",
  kb: "Βάση γνώσεων",
} as const;
export type Action = keyof typeof ACTION_LABEL;

type AreaDef = { key: string; group: string; label: string; hint: string; actions: readonly Action[] };

// ---- Περιοχές της εφαρμογής του συνδρομητή ----
export const AREAS = [
  { key: "dashboard", group: "Επισκόπηση", label: "Πίνακας ελέγχου", hint: "Πωλήσεις ημέρας και ενότητες της επιχείρησης", actions: ["read"] },
  { key: "pos", group: "Ταμείο & τιμολόγηση", label: "Ταμείο", hint: "Έκδοση αποδείξεων", actions: ["use"] },
  { key: "receipts", group: "Ταμείο & τιμολόγηση", label: "Αποδείξεις", hint: "Όσες έχουν εκδοθεί", actions: ["read", "reissue"] },
  { key: "devices", group: "Ταμείο & τιμολόγηση", label: "Συσκευές", hint: "Ταμεία, ψυγεία και εκτυπωτές (η προσθήκη ταμείου αλλάζει τη χρέωση)", actions: ["read", "add", "edit", "delete"] },
  { key: "warehouses", group: "Αποθήκη & αγορές", label: "Αποθήκες", hint: "Αποθηκευτικοί χώροι, σύνδεσή τους με καταστήματα και προεπιλογές", actions: ["read", "add", "edit"] },
  { key: "purchases", group: "Αποθήκη & αγορές", label: "Τιμολόγια αγοράς", hint: "Παραλαβές από προμηθευτές: αντιστοίχιση γραμμών, παρτίδες και είσοδος αποθέματος", actions: ["read", "add", "edit"] },
  { key: "parties", group: "Πελάτες & πωλήσεις", label: "Συναλλασσόμενοι", hint: "Πελάτες, προμηθευτές, franchisees και συνεργάτες: καρτέλες, αρχεία και συναινέσεις τους", actions: ["read", "add", "edit", "delete"] },
  { key: "products", group: "Συνταγολόγιο", label: "Προϊόντα & κατηγορίες", hint: "Ο κατάλογος του ταμείου: τιμή και συντελεστής ΦΠΑ ανά προϊόν", actions: ["read", "add", "edit"] },
  { key: "items", group: "Συνταγολόγιο", label: "Γενικά είδη", hint: "Τα είδη των συνταγών και η σύνδεσή τους με εμπορικά είδη και προμηθευτές", actions: ["read", "add", "edit"] },
  { key: "recipes", group: "Συνταγολόγιο", label: "Συνταγές", hint: "Συνταγές παγωτού: γραμμές σε γραμμάρια, τεχνική ανάλυση (PAC/POD) και κόστος", actions: ["read", "add", "edit"] },
  { key: "production", group: "Παραγωγή", label: "Παραγωγή", hint: "Παρτίδες παραγωγής: FEFO κατανάλωση υλικών από το απόθεμα και ιχνηλασιμότητα", actions: ["read", "add"] },
  { key: "tickets", group: "Υποστήριξη", label: "Αιτήματα υποστήριξης", hint: "Βλέπει και απαντά στα αιτήματα όλης της επιχείρησης (ο καθένας βλέπει πάντα τα δικά του)", actions: ["manage"] },
  { key: "billing", group: "Ρυθμίσεις", label: "Συνδρομή", hint: "Το κόστος της συνδρομής και η πληρωμή της", actions: ["read"] },
  { key: "stores", group: "Ρυθμίσεις", label: "Εποχιακή παύση καταστημάτων", hint: "Κλείνει και ανοίγει ξανά ένα κατάστημα για την περίοδο που δεν λειτουργεί (αλλάζει τη χρέωση)", actions: ["pause"] },
  { key: "users", group: "Ρυθμίσεις", label: "Χρήστες, ομάδες & ρόλοι", hint: "Προσκλήσεις, ομάδες, ρόλοι και δικαιώματα", actions: ["read", "add", "edit", "delete"] },
  { key: "gdpr", group: "Ρυθμίσεις", label: "GDPR & συναινέσεις", hint: "Συναινέσεις, αιτήματα διαγραφής και ημερολόγιο προσωπικών δεδομένων", actions: ["read", "edit"] },
] as const satisfies readonly AreaDef[];
export type AreaKey = (typeof AREAS)[number]["key"];
export type Permission = `${AreaKey}.${string}`;

/** Επίπεδη λίστα: ένα κλειδί ανά (περιοχή × ενέργεια), με την ομαδοποίηση του μενού για τις οθόνες. */
export const PERMISSIONS = AREAS.flatMap((a) => a.actions.map((action) => ({ key: `${a.key}.${action}` as Permission, area: a.key as AreaKey, action, group: a.group, label: a.label, hint: a.hint })));
export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);
export const isPermission = (v: string): v is Permission => PERMISSIONS.some((p) => p.key === v);
/** «receipts.reissue» → «Αποδείξεις — Επανεκτύπωση»· μονο-ενεργειακές περιοχές κρατούν σκέτο το label. */
export const permissionLabel = (key: string) => {
  const p = PERMISSIONS.find((x) => x.key === key);
  if (!p) return key;
  const area = AREAS.find((a) => a.key === p.area)!;
  return area.actions.length === 1 ? p.label : `${p.label} — ${ACTION_LABEL[p.action]}`;
};

/** Μοναδικά, με αυτόματο read: όποιος έχει άλλη ενέργεια σε περιοχή που έχει read, παίρνει και το read. */
function normalizeIn(catalog: readonly AreaDef[], keys: readonly string[]): string[] {
  const valid = new Set(catalog.flatMap((a) => a.actions.map((x) => `${a.key}.${x}`)));
  const set = new Set(keys.filter((k) => valid.has(k)));
  for (const a of catalog) {
    if ((a.actions as readonly string[]).includes("read") && a.actions.some((x) => x !== "read" && set.has(`${a.key}.${x}`))) set.add(`${a.key}.read`);
  }
  return [...set];
}
export const normalize = (keys: readonly string[]): Permission[] => normalizeIn(AREAS, keys) as Permission[];

// Παλιά επίπεδα κλειδιά («έχει/δεν έχει») → νέα. Τα δεδομένα της βάσης μεταφράζονται στην ανάγνωση,
// οπότε η εφαρμογή δουλεύει και πριν τρέξει το scripts/migrate-permissions.ts που τα ξαναγράφει.
const LEGACY_ORG: Record<string, Permission[]> = {
  "dashboard.view": ["dashboard.read"],
  "pos.use": ["pos.use"],
  "receipts.view": ["receipts.read", "receipts.reissue"],
  "devices.manage": ["devices.read", "devices.add", "devices.edit", "devices.delete"],
  "customers.manage": ["parties.read", "parties.add", "parties.edit", "parties.delete"],
  "billing.view": ["billing.read"],
  "stores.pause": ["stores.pause"],
  "users.manage": ["users.read", "users.add", "users.edit", "users.delete"],
  "tickets.manage": ["tickets.manage"],
  "gdpr.manage": ["gdpr.read", "gdpr.edit"],
};
/** Παλιά και νέα κλειδιά → η τελική λίστα νέων. Άγνωστα κλειδιά πετιούνται. */
export const expandOrg = (keys: readonly string[]): Permission[] => normalize(keys.flatMap((k) => LEGACY_ORG[k] ?? [k]));
/** Τα δικαιώματα ρόλου επιχείρησης όπως ισχύουν: ο κλειδωμένος («Επιχειρηματίας») έχει πάντα όλα, και όσα προστεθούν αργότερα. */
export const orgPermissionsOf = (role: { locked: boolean; permissions: string[] }): Permission[] => (role.locked ? ALL_PERMISSIONS : expandOrg(role.permissions));

/** Ποιο δικαίωμα (το read της περιοχής) θέλει κάθε σελίδα. Ό,τι δεν αναφέρεται θέλει τον πίνακα ελέγχου. */
const PAGE: Record<string, Permission> = { "/pos": "pos.use", "/receipts": "receipts.read", "/devices": "devices.read", "/inventory": "warehouses.read", "/purchases": "purchases.read", "/billing": "billing.read", "/users": "users.read", "/gdpr": "gdpr.read", "/customers": "parties.read", "/parties": "parties.read", "/products": "products.read", "/items": "items.read", "/recipes": "recipes.read", "/production": "production.read", "/traceability": "production.read" };
export const permissionFor = (path: string): Permission => PAGE[Object.keys(PAGE).find((p) => path === p || path.startsWith(`${p}/`)) ?? ""] ?? "dashboard.read";

/** Οι τρεις ρόλοι που αποκτά κάθε νέα επιχείρηση. Ο «Επιχειρηματίας» είναι κλειδωμένος: έχει πάντα όλα τα δικαιώματα. */
export const SYSTEM_ROLES: { name: string; permissions: Permission[]; locked: boolean }[] = [
  { name: "Επιχειρηματίας", permissions: ALL_PERMISSIONS, locked: true },
  {
    name: "Manager",
    permissions: ["dashboard.read", "pos.use", "receipts.read", "receipts.reissue", "devices.read", "devices.add", "devices.edit", "devices.delete", "warehouses.read", "warehouses.add", "warehouses.edit", "purchases.read", "purchases.add", "purchases.edit", "parties.read", "parties.add", "parties.edit", "parties.delete", "products.read", "products.add", "products.edit", "items.read", "items.add", "items.edit", "recipes.read", "recipes.add", "recipes.edit", "production.read", "production.add", "tickets.manage"],
    locked: false,
  },
  { name: "Υπάλληλος", permissions: ["pos.use", "receipts.read"], locked: false },
];

/** Κανείς δεν δίνει δικαίωμα που δεν έχει ο ίδιος (ούτε με ρόλο, ούτε με ομάδα, ούτε αλλάζοντας έναν ρόλο). */
export const canGrant = (actor: readonly string[], wanted: readonly string[]) => wanted.every((p) => actor.includes(p));

// ---- Προσωπικό της πλατφόρμας (όχι των συνδρομητών). Σταθεροί ρόλοι: ορίζονται εδώ, όχι από οθόνη. ----
export const PLATFORM_AREAS = [
  { key: "orgs", group: "Συνδρομητές", label: "Συνδρομητές", hint: "Οι επιχειρήσεις-πελάτες της πλατφόρμας", actions: ["read", "add", "edit", "delete"] },
  { key: "billing", group: "Συνδρομητές", label: "Συνδρομές & χρεώσεις", hint: "Πακέτα, χρεώσεις και πληρωμές συνδρομητών", actions: ["read", "edit"] },
  { key: "setup", group: "Συνδρομητές", label: "Αρχικοποίηση", hint: "Στοιχεία, Viva, καταστήματα, αποθήκες, εκτυπωτές, ταμεία του συνδρομητή", actions: ["edit"] },
  { key: "users", group: "Συνδρομητές", label: "Χρήστες συνδρομητών", hint: "Προσκλήσεις και ρόλοι στους λογαριασμούς των πελατών", actions: ["read", "add", "edit", "delete"] },
  { key: "parties", group: "Συνδρομητές", label: "Συναλλασσόμενοι συνδρομητών", hint: "Πελάτες και προμηθευτές των πελατών μας — δίνεται μόνο χειροκίνητα", actions: ["read"] },
  { key: "support", group: "Υποστήριξη", label: "Υποστήριξη πελατών", hint: "Αιτήματα, βάση γνώσεων, απομακρυσμένη σύνδεση σε συσκευές", actions: ["tickets", "kb", "remote"] },
  { key: "staff", group: "Πλατφόρμα", label: "Προσωπικό πλατφόρμας", hint: "Μέλη, ρόλοι, ομάδες και πρόσβαση σε καταστήματα πελατών", actions: ["read", "add", "edit", "delete"] },
  { key: "settings", group: "Πλατφόρμα", label: "Ρυθμίσεις πλατφόρμας", hint: "Email, λίστες αναφοράς, υποδομή, ασφάλεια και συνέχεια λειτουργίας", actions: ["read", "edit"] },
  { key: "gdpr", group: "Πλατφόρμα", label: "GDPR πλατφόρμας", hint: "Συναινέσεις, αιτήματα διαγραφής, ημερολόγιο", actions: ["read", "edit"] },
] as const satisfies readonly AreaDef[];
export type PlatformAreaKey = (typeof PLATFORM_AREAS)[number]["key"];
export type PlatformPermission = `${PlatformAreaKey}.${string}`;

/** «orgs.read» → «Συνδρομητές — Προβολή»· μονο-ενεργειακές περιοχές κρατούν σκέτο το label. */
export const PLATFORM_PERMISSIONS = Object.fromEntries(
  PLATFORM_AREAS.flatMap((a) => a.actions.map((act) => [`${a.key}.${act}`, a.actions.length === 1 ? a.label : `${a.label} — ${ACTION_LABEL[act]}`])),
) as Record<PlatformPermission, string>;
export const ALL_PLATFORM_PERMISSIONS = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];
export const isPlatformPermission = (v: unknown): v is PlatformPermission => typeof v === "string" && v in PLATFORM_PERMISSIONS;
export const normalizePlatform = (keys: readonly string[]): PlatformPermission[] => normalizeIn(PLATFORM_AREAS, keys) as PlatformPermission[];

const LEGACY_PLATFORM: Record<string, PlatformPermission[]> = {
  "orgs.view": ["orgs.read"],
  "orgs.create": ["orgs.add"],
  "billing.manage": ["billing.read", "billing.edit"],
  "setup.manage": ["setup.edit"],
  "users.manage": ["users.read", "users.add", "users.edit", "users.delete"],
  "settings.manage": ["settings.read", "settings.edit"],
  "staff.manage": ["staff.read", "staff.add", "staff.edit", "staff.delete"],
  "gdpr.manage": ["gdpr.read", "gdpr.edit"],
  "support.remote": ["support.remote"],
  "support.tickets": ["support.tickets"],
  "support.kb": ["support.kb"],
  "parties.view": ["parties.read"],
};
export const expandPlatform = (keys: readonly string[]): PlatformPermission[] => normalizePlatform(keys.flatMap((k) => LEGACY_PLATFORM[k] ?? [k]));

export type PlatformRoleKey = "SUPER_ADMIN" | "MANAGER" | "STAFF" | "SUPPORT";

export const PLATFORM_ROLES: Record<PlatformRoleKey, { label: string; hint: string; permissions: PlatformPermission[] }> = {
  SUPER_ADMIN: { label: "Super Admin", hint: "Όλα, μαζί με ρυθμίσεις και προσωπικό", permissions: ALL_PLATFORM_PERMISSIONS },
  MANAGER: { label: "Manager", hint: "Συνδρομητές, συνδρομές και αρχικοποίηση", permissions: expandPlatform(["orgs.view", "orgs.create", "billing.manage", "setup.manage", "users.manage", "gdpr.manage", "support.remote", "support.tickets", "support.kb"]) },
  STAFF: { label: "Υπάλληλος εφαρμογής", hint: "Αρχικοποίηση συνδρομητών, χωρίς χρεώσεις", permissions: expandPlatform(["orgs.view", "setup.manage", "users.manage", "support.remote", "support.tickets"]) },
  SUPPORT: { label: "Υπάλληλος υποστήριξης", hint: "Βλέπει τους συνδρομητές και βοηθά τους χρήστες τους", permissions: expandPlatform(["orgs.view", "users.manage", "support.remote", "support.tickets"]) },
};

// Οι ρόλοι του προσωπικού έχουν τα παραπάνω δικαιώματα ως αφετηρία· ο Super Admin μπορεί να τα αλλάξει από τις Ρυθμίσεις.
// shortcut: οι αλλαγές κρατιούνται στη μνήμη της διεργασίας και φορτώνονται σε κάθε αίτημα (lib/platform-roles.ts)·
// έτσι το platformCan μένει σύγχρονο. Αν χρειαστούν δικοί σας ρόλοι προσωπικού (όχι μόνο οι 4), θέλει πίνακα.
export type PlatformOverrides = Partial<Record<PlatformRoleKey, PlatformPermission[]>>;
let overrides: PlatformOverrides = {};
/** Διαβάζει τις αποθηκευμένες αλλαγές. Ό,τι δεν είναι έγκυρο αγνοείται· ο Super Admin δεν αλλάζει ποτέ. */
export function parsePlatformOverrides(raw: string | null | undefined): PlatformOverrides {
  try {
    const j = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).filter(([k, v]) => k in PLATFORM_ROLES && k !== "SUPER_ADMIN" && Array.isArray(v)).map(([k, v]) => [k, expandPlatform(v as string[])]));
  } catch {
    return {};
  }
}
export const applyPlatformOverrides = (o: PlatformOverrides) => { overrides = o; };
export const platformPermissionsOf = (role: PlatformRoleKey): PlatformPermission[] => (role === "SUPER_ADMIN" ? PLATFORM_ROLES.SUPER_ADMIN.permissions : (overrides[role] ?? PLATFORM_ROLES[role].permissions));
/** Μέλος προσωπικού: ο σταθερός ρόλος του, ο δικός σας ρόλος που (όταν υπάρχει) τον αντικαθιστά, και οι ομάδες του. */
// Οι ομάδες έρχονται είτε σκέτες ({permissions}) είτε ως εγγραφές σύνδεσης του Prisma ({group: {permissions}}).
export type StaffLike = { platformRole: PlatformRoleKey | null; staffRole?: { name: string; permissions: string[] } | null; staffGroups?: readonly ({ permissions: string[] } | { group: { permissions: string[] } })[] };
type Who = StaffLike | PlatformRoleKey | null | undefined;
const asStaff = (who: Who): StaffLike | null => (typeof who === "string" ? { platformRole: who } : who ?? null);
/** Τα δικαιώματα προσωπικού: (δικός σας ρόλος ΑΝΤΙ του σταθερού) ∪ ομάδες. Ένωση μόνο — ποτέ αφαίρεση. */
export function staffPermissions(who: Who): PlatformPermission[] {
  const u = asStaff(who);
  if (!u?.platformRole) return [];
  const base = u.staffRole && u.platformRole !== "SUPER_ADMIN" ? u.staffRole.permissions : platformPermissionsOf(u.platformRole);
  const groups = (u.staffGroups ?? []).flatMap((g) => ("permissions" in g ? g.permissions : g.group.permissions));
  return expandPlatform([...base, ...groups]);
}
export const staffRoleLabel = (who: Who) => { const u = asStaff(who); return u?.platformRole ? (u.staffRole && u.platformRole !== "SUPER_ADMIN" ? u.staffRole.name : PLATFORM_ROLES[u.platformRole].label) : ""; };
export const platformCan = (who: Who, p: PlatformPermission) => staffPermissions(who).includes(p);
