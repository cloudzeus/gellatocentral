// Εγγραφή του οδηγού στησίματος: ένα σχέδιο (lib/store-setup.ts) γίνεται κατάστημα, ψυγεία, ταμεία, εκτυπωτές και τραπέζια σε μία συναλλαγή.
import { db } from "./db.ts";
import { expand, freeSeries, type Plan, type StoreKind } from "./store-setup.ts";
import { attachWarehouse } from "./warehouses.ts";

export async function createStoreFromPlan(orgId: string, input: { name: string; address: string | null; legalEntityId: string | null; kind: StoreKind; plan: Plan }) {
  const e = expand(input.plan);
  return db.$transaction(async (tx) => {
    const store = await tx.store.create({ data: { orgId, name: input.name, address: input.address, kind: input.kind, legalEntityId: input.legalEntityId } });
    // το «πουλήσιμο» ψυγείο δένεται πρώτο, ώστε να γίνει η προεπιλεγμένη αποθήκη του καταστήματος
    const spaces = [...e.spaces].sort((a, b) => Number(b.name === e.sellFrom) - Number(a.name === e.sellFrom));
    let sellFromId: string | null = null;
    for (const s of spaces) {
      const warehouse = await tx.warehouse.create({ data: { orgId, name: `${s.name} · ${input.name}` } });
      await attachWarehouse(tx, { orgId, storeId: store.id, warehouseId: warehouse.id });
      if (s.name === e.sellFrom) sellFromId = warehouse.id;
      if (s.temp) await tx.device.create({ data: { orgId, storeId: store.id, name: s.name, kind: s.vending ? "VENDING_MACHINE" : "FRIDGE", warehouseId: warehouse.id, tempMin: s.temp[0], tempMax: s.temp[1] } });
    }
    const printers = [];
    for (const p of e.printers) {
      // αποδείξεων: USB πάνω στο ταμείο (έτοιμος)· παραγγελιών: στο δίκτυο, θέλει διεύθυνση στην ετοιμότητα
      printers.push(await tx.printer.create({ data: { orgId, storeId: store.id, name: p.name, role: p.role, connection: p.role === "RECEIPTS" ? "USB" : "NETWORK" } }));
    }
    const receiptPrinter = printers.find((p) => p.role === "RECEIPTS") ?? null;
    const taken = (await tx.device.findMany({ where: { orgId, series: { not: null } }, select: { series: true } })).map((d) => d.series);
    const series = freeSeries(taken, e.tills.length);
    for (const [i, t] of e.tills.entries()) {
      await tx.device.create({ data: { orgId, storeId: store.id, name: t.name, kind: "POS_ANDROID", series: series[i], defaultWarehouseId: sellFromId, printerId: t.handheld ? null : receiptPrinter?.id } });
    }
    if (e.tables.length) await tx.diningTable.createMany({ data: e.tables.map((t) => ({ orgId, storeId: store.id, name: t.name, zone: t.zone, seats: t.seats, position: t.position })) });
    return store;
  });
}
