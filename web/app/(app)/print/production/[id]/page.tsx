import { notFound } from "next/navigation";
import { PrintableDocument } from "@/components/printable-document";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { formatStockQuantity } from "@/lib/stock-view";

const date = new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" });
const ALLERGENS: Record<string, string> = { milk: "Γάλα", eggs: "Αυγά", nuts: "Ξηροί καρποί", peanuts: "Φιστίκια", gluten: "Γλουτένη", soy: "Σόγια", sesame: "Σουσάμι", celery: "Σέλινο", mustard: "Σινάπι", fish: "Ψάρι", crustaceans: "Οστρακοειδή", molluscs: "Μαλάκια", lupin: "Λούπινο", sulphites: "Θειώδη" };

export default async function ProductionLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStockContext("production.read");
  const { id } = await params;
  const batch = await db.productionBatch.findFirst({ where: { id, orgId: ctx.orgId }, include: { org: true, recipe: true, warehouse: true, items: { include: { genericItem: { include: { baseUnit: true, composition: true } } } } } });
  if (!batch) notFound();
  await requireStockContext("production.read", { warehouseIds: [batch.warehouseId, batch.destinationWarehouseId ?? batch.warehouseId] });
  const output = batch.outputLotId ? await db.stockLot.findFirst({ where: { id: batch.outputLotId, orgId: ctx.orgId }, include: { genericItem: { include: { baseUnit: true } } } }) : null;
  const lines = new Map<string, { name: string; quantity: number; dimension: string }>();
  const contains = new Set<string>(), traces = new Set<string>();
  for (const item of batch.items) {
    const row = lines.get(item.genericItemId) ?? { name: item.genericItem.name, quantity: 0, dimension: item.genericItem.baseUnit.dimension };
    row.quantity += item.quantity; lines.set(item.genericItemId, row);
    item.genericItem.composition?.allergensContains.forEach((key) => contains.add(key));
    item.genericItem.composition?.allergensTraces.forEach((key) => traces.add(key));
  }
  contains.forEach((key) => traces.delete(key));
  return <PrintableDocument org={batch.org} entityType="production_batch" entityId={batch.id} title={`Ετικέτα παρτίδας ${batch.batchNumber}`} subtitle={`${batch.recipe.name} · ${batch.warehouse.name}`}>
    <section><h2>Στοιχεία παρτίδας</h2><dl className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div><dt className="text-xs">Παραγωγή</dt><dd className="font-medium">{date.format(batch.producedAt)}</dd></div><div><dt className="text-xs">Πραγματική απόδοση</dt><dd className="font-medium">{batch.quantityGrams.toLocaleString("el-GR")} g</dd></div><div><dt className="text-xs">Λήξη</dt><dd className="font-medium">{output?.expiresAt ? date.format(output.expiresAt) : "Δεν έχει οριστεί"}</dd></div><div><dt className="text-xs">Ποιοτική κατάσταση</dt><dd className="font-medium">{output?.holdStatus ?? "Χωρίς output lot"}</dd></div></dl>{output ? <p className="mt-3">Παραγόμενο είδος: <strong>{output.genericItem.name}</strong> · πραγματική απόδοση {batch.quantityGrams.toLocaleString("el-GR")} g</p> : null}</section>
    <section><h2>Συστατικά που καταναλώθηκαν</h2><table><thead><tr><th>Είδος</th><th>Ποσότητα</th></tr></thead><tbody>{[...lines.values()].map((line) => <tr key={line.name}><td>{line.name}</td><td>{formatStockQuantity(line.quantity, line.dimension)}</td></tr>)}</tbody></table></section>
    <section><h2>Αλλεργιογόνα</h2><p><strong>Περιέχει:</strong> {contains.size ? [...contains].map((key) => ALLERGENS[key] ?? key).join(", ") : "Δεν έχει δηλωθεί αλλεργιογόνο στα τεκμηριωμένα συστατικά."}</p>{traces.size ? <p className="mt-1"><strong>Μπορεί να περιέχει ίχνη:</strong> {[...traces].map((key) => ALLERGENS[key] ?? key).join(", ")}</p> : null}</section>
  </PrintableDocument>;
}
