// Demo προσωπικό: ένας εργαζόμενος ανά ειδικότητα (16), μερικοί με 2–3 ειδικότητες και δύο καταστήματα,
// όλοι με PIN ταμείου 1234, δημοσιευμένες βάρδιες 7 ημερών και θέσεις αποθήκης για την τακτοποίηση.
// Ξανατρέχει χωρίς διπλά (σταθερά ids). Μόνο για demo tenant:
//   npx tsx --env-file=.env scripts/demo-staff.mts <orgId>
import { db } from "../lib/db";
import { SPECIALTIES } from "../lib/specialties";
import { pinHash } from "../lib/till-shift";
import { stockBalances } from "../lib/stock-db";

const orgId = process.argv[2];
if (!orgId) throw new Error("Δώσε orgId του demo tenant");

// [ειδικότητα, όνομα, επιπλέον ειδικότητες, και στο δεύτερο κατάστημα]
const PEOPLE: [string, string, string[], boolean][] = [
  ["waiter", "Ελένη Σταύρου", ["barman"], true],
  ["service_lead", "Γιώργος Αντωνίου", ["waiter", "cashier"], false],
  ["service_assistant", "Κατερίνα Μιχαήλ", [], false],
  ["cashier", "Δήμητρα Παππά", ["service_assistant"], true],
  ["reservations", "Σοφία Νικολάου", ["cashier"], false],
  ["barman", "Άρης Βλάχος", [], true],
  ["chef", "Μανώλης Κρητικός", ["sous_chef"], false],
  ["sous_chef", "Στέλιος Γεωργίου", ["cook"], false],
  ["cook", "Παναγιώτα Ρήγα", [], false],
  ["dishwasher", "Ιμπραήμ Χασάν", [], false],
  ["storekeeper", "Θανάσης Λάμπρου", ["purchasing"], true],
  ["purchasing", "Βασιλική Ζαφείρη", ["storekeeper"], false],
  ["accounting_assistant", "Ευαγγελία Τσάκωνα", [], false],
  ["store_manager", "Κώστας Δημητρίου", ["cashier", "storekeeper"], true],
  ["owner", "Αλέξανδρος Μαρκόπουλος", ["store_manager"], true],
  ["admin", "Ναταλία Ιωάννου", ["accounting_assistant"], true],
];
const SPOTS = ["Ψυγείο 1 · Ράφι πάνω", "Ψυγείο 1 · Ράφι κάτω", "Ψυγείο 2 · Γαλακτοκομικά", "Καταψύκτης · Βάσεις", "Ξηρά αποθήκη · Ράφι Α", "Ξηρά αποθήκη · Ράφι Β"];

const stores = await db.store.findMany({ where: { orgId, active: true }, orderBy: { id: "asc" }, select: { id: true, name: true } });
if (!stores.length) throw new Error("Ο tenant δεν έχει κατάστημα");
let second = stores[1];
if (!second) second = await db.store.upsert({ where: { id: `demo_store2_${orgId}` }, update: {}, create: { id: `demo_store2_${orgId}`, orgId, name: "Κατάστημα Γλυφάδας (demo)" }, select: { id: true, name: true } });
const home = stores[0];

const athensMidnight = (d: Date) => new Date(`${d.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" })}T00:00:00+02:00`);
const today = athensMidnight(new Date());

for (const [i, [key, name, extra, both]] of PEOPLE.entries()) {
  if (!SPECIALTIES.some((s) => s.key === key)) throw new Error(`Άγνωστη ειδικότητα ${key}`);
  const id = `demo_staff_${key}`;
  const all = [key, ...extra];
  const storeIds = both ? [home.id, second.id] : [home.id];
  await db.$transaction(async (tx) => {
    await tx.employee.upsert({
      where: { id },
      update: { name, active: true, storeId: home.id, tillPinHash: pinHash(id, "1234") },
      create: { id, orgId, name, storeId: home.id, email: `${key.replace(/_/g, "-")}@demo.test`, tillPinHash: pinHash(id, "1234") },
    });
    await tx.employeeSpecialty.deleteMany({ where: { employeeId: id } });
    await tx.employeeSpecialty.createMany({ data: all.map((s) => ({ employeeId: id, specialty: s, isPrimary: s === key })) });
    await tx.employeeStore.deleteMany({ where: { employeeId: id } });
    await tx.employeeStore.createMany({ data: storeIds.map((storeId) => ({ employeeId: id, storeId })) });
    // βάρδιες 7 ημερών: πρωί ή απόγευμα εναλλάξ, μία μέρα ρεπό· όσοι έχουν δύο καταστήματα πάνε στο δεύτερο Τετάρτη–Πέμπτη
    await tx.shift.deleteMany({ where: { employeeId: id, startsAt: { gte: today } } });
    const rows = [];
    for (let d = 0; d < 7; d++) {
      if ((d + i) % 7 === 6) continue;
      const morning = (d + i) % 2 === 0;
      const start = new Date(today.getTime() + d * 86_400_000 + (morning ? 8 : 16) * 3_600_000);
      const wd = new Date(start.getTime() + 2 * 3_600_000).getUTCDay();
      const storeId = both && (wd === 3 || wd === 4) ? second.id : home.id;
      // η ειδικότητα της βάρδιας: συνήθως η κύρια, τα Σάββατα η δεύτερη (για να φαίνεται η πρόταση ρόλου)
      const specialty = wd === 6 && extra[0] ? extra[0] : key;
      rows.push({ orgId, employeeId: id, storeId, specialty, startsAt: start, endsAt: new Date(start.getTime() + 8 * 3_600_000), breakMinutes: 30, publishedAt: new Date() });
    }
    await tx.shift.createMany({ data: rows });
  });
  console.log(`${name.padEnd(24)} ${all.join(", ").padEnd(40)} ${storeIds.length} καταστ. · PIN 1234`);
}

// θέσεις στις αποθήκες του κύριου καταστήματος και θέση για τα μισά υλικά με απόθεμα (τα άλλα μένουν «Χωρίς θέση»)
const warehouseIds = (await db.storeWarehouse.findMany({ where: { storeId: home.id }, select: { warehouseId: true } })).map((w) => w.warehouseId);
for (const warehouseId of warehouseIds) {
  const spots = [];
  for (const name of SPOTS) spots.push(await db.storageSpot.upsert({ where: { warehouseId_name: { warehouseId, name } }, update: { active: true }, create: { orgId, warehouseId, name } }));
  const items = [...new Set((await stockBalances(db, { orgId, warehouseIds: [warehouseId] })).filter((b) => b.quantity > 0).map((b) => b.genericItemId))].sort();
  for (const [n, genericItemId] of items.entries()) {
    if (n % 2) continue;
    await db.itemSpot.upsert({ where: { genericItemId_warehouseId: { genericItemId, warehouseId } }, update: {}, create: { orgId, genericItemId, warehouseId, spotId: spots[n % spots.length].id, updatedByName: "Demo" } });
  }
  console.log(`Αποθήκη ${warehouseId}: ${spots.length} θέσεις, θέση σε ${Math.ceil(items.length / 2)} από ${items.length} υλικά`);
}
console.log(`Καταστήματα: ${home.name} + ${second.name}`);
await db.$disconnect();
