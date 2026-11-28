// Ειδικότητες προσωπικού και τι ανοίγει η καθεμία στη συσκευή του καταστήματος (καθαρή λογική, ίδια στο κινητό).
export type DeviceView = "sale" | "tables" | "reservations" | "orders" | "transactions" | "receiving" | "stock";
export type SpecialtyGroup = "service" | "kitchen" | "warehouse" | "management";

type Def = { key: string; name: string; group: SpecialtyGroup; views: DeviceView[]; cash: boolean };
const ALL: DeviceView[] = ["sale", "tables", "reservations", "orders", "transactions", "receiving", "stock"];

// cash = ανοίγει συρτάρι με μετρητά έναρξης· οι υπόλοιποι ρόλοι ξεκινούν βάρδια χωρίς μετρητά
export const SPECIALTIES: readonly Def[] = [
  { key: "waiter", name: "Σερβιτόρος", group: "service", views: ["tables", "sale", "reservations"], cash: false },
  { key: "service_lead", name: "Υπεύθυνος σέρβις", group: "service", views: ["tables", "sale", "reservations", "orders", "transactions"], cash: true },
  { key: "service_assistant", name: "Βοηθός σέρβις", group: "service", views: ["tables", "sale"], cash: false },
  { key: "cashier", name: "Ταμίας", group: "service", views: ["sale", "tables", "reservations", "orders", "transactions"], cash: true },
  { key: "reservations", name: "Υπεύθυνος κρατήσεων", group: "service", views: ["reservations", "tables"], cash: false },
  { key: "barman", name: "Barman", group: "service", views: ["sale", "tables", "transactions"], cash: true },
  { key: "chef", name: "Chef", group: "kitchen", views: ["orders", "stock"], cash: false },
  { key: "sous_chef", name: "Sous chef", group: "kitchen", views: ["orders", "stock"], cash: false },
  { key: "cook", name: "Μάγειρας", group: "kitchen", views: ["orders"], cash: false },
  { key: "dishwasher", name: "Λαντζέρης", group: "kitchen", views: [], cash: false },
  { key: "storekeeper", name: "Αποθηκάριος", group: "warehouse", views: ["receiving", "stock"], cash: false },
  { key: "purchasing", name: "Υπεύθυνος παραγγελιών", group: "warehouse", views: ["receiving", "stock"], cash: false },
  { key: "accounting_assistant", name: "Βοηθός λογιστή", group: "warehouse", views: ["transactions"], cash: false },
  { key: "store_manager", name: "Μάνατζερ καταστήματος", group: "management", views: ALL, cash: true },
  { key: "owner", name: "Ιδιοκτήτης", group: "management", views: ALL, cash: true },
  { key: "admin", name: "Διοίκηση", group: "management", views: ALL, cash: true },
];

export const GROUPS: [SpecialtyGroup, string][] = [["service", "Σέρβις"], ["kitchen", "Κουζίνα"], ["warehouse", "Αποθήκη και γραφείο"], ["management", "Διοίκηση"]];
const byKey = new Map(SPECIALTIES.map((s) => [s.key, s]));
export const isSpecialty = (key: string) => byKey.has(key);
export const specialtyName = (key: string | null | undefined) => (key ? byKey.get(key)?.name ?? key : null);
/** Η ομάδα του ρόλου (σέρβις, κουζίνα, αποθήκη, διοίκηση): στη συσκευή δίνει χρώμα και εικονίδιο στον ρόλο. */
export const specialtyGroup = (key: string | null | undefined) => (key ? byKey.get(key)?.group ?? null : null);

/** Τι βλέπει ο ρόλος στη συσκευή. Χωρίς ρόλο (υπάλληλος χωρίς ειδικότητες, ή κατάστημα χωρίς βάρδιες) βλέπει όλα, όπως πριν. */
export function roleViews(role: string | null | undefined): DeviceView[] {
  if (!role) return ALL;
  return byKey.get(role)?.views ?? [];
}
export const roleHasCash = (role: string | null | undefined) => !role || (byKey.get(role)?.cash ?? false);
export const canReceive = (role: string | null | undefined) => roleViews(role).includes("receiving");

/** Ο ρόλος που προτείνεται στη σύνδεση: της βάρδιας του προγράμματος, αλλιώς η κύρια ειδικότητα, αλλιώς η πρώτη. */
export function suggestedRole(specialties: { specialty: string; isPrimary: boolean }[], scheduled?: string | null) {
  if (scheduled && specialties.some((s) => s.specialty === scheduled)) return scheduled;
  return (specialties.find((s) => s.isPrimary) ?? specialties[0])?.specialty ?? null;
}
