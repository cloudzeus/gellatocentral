// Τι χρειάζεται μια επιχείρηση για να εκδώσει πραγματική (όχι δοκιμαστική) απόδειξη.
type Org = {
  vivaMerchantId: string | null;
  subscription: { status: string; currentPeriodEnd: Date } | null;
  members?: unknown[];
  stores: { active: boolean; warehouses: { active: boolean }[]; devices: { active: boolean; vivaTerminalId: string | null; printerId: string | null }[] }[];
};

export function setupSteps(org: Org, now = new Date()) {
  const stores = org.stores.filter((s) => s.active);
  const devices = stores.flatMap((s) => s.devices).filter((d) => d.active);
  const sub = org.subscription;
  return [
    { label: "Συνδρομή σε ισχύ", done: !!sub && ["TRIALING", "ACTIVE"].includes(sub.status) && sub.currentPeriodEnd > now, fix: "subscription" },
    { label: "Κωδικός εμπόρου Viva", done: !!org.vivaMerchantId, fix: "viva" },
    { label: "Ενεργό υποκατάστημα", done: stores.length > 0, fix: "stores" },
    { label: "Αποθήκη", done: stores.some((s) => s.warehouses.some((w) => w.active)), fix: "warehouses" },
    { label: "Ταμείο με τερματικό Viva", done: devices.some((d) => d.vivaTerminalId), fix: "devices" },
    { label: "Εκτυπωτής δεμένος σε ταμείο", done: devices.some((d) => d.printerId), fix: "printers" },
    ...(org.members ? [{ label: "Χρήστης για σύνδεση", done: org.members.length > 0, fix: "users" }] : []),
  ];
}
