import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { Badge, btn, Card, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { productionForecast } from "@/lib/forecast-db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity } from "@/lib/stock-view";
import { notFound } from "next/navigation";

export default async function ProductionForecastPage({ searchParams }: PageProps<"/production/forecast">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (typeof q.warehouse === "string" && !warehouses.some((warehouse) => warehouse.id === q.warehouse)) notFound();
  const warehouseId = typeof q.warehouse === "string" ? q.warehouse : warehouses[0]?.id;
  const rows = warehouseId ? await productionForecast(db, ctx, warehouseId) : [];
  const suggestions = rows.filter((row) => row.suggestedBase > 0).sort((a, b) => b.suggestedBase - a.suggestedBase || a.name.localeCompare(b.name, "el"));
  const warehouse = warehouses.find((row) => row.id === warehouseId);
  return <Page section="Παραγωγή" title="Πρόβλεψη 7 ημερών" description="Ιστορικό 28 ημερών + confirmed χονδρική − διαθέσιμο απόθεμα − προγραμματισμένη παραγωγή" actions={<div className="flex gap-2"><Link href="/production/plans" className={btn("outline", "sm")}><CalendarClock /> Προγραμματισμός</Link><Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παρτίδες</Link></div>}>
    <div className="grid max-w-7xl gap-4">
      <Card className="p-4"><form className="grid items-end gap-3 sm:grid-cols-[minmax(0,20rem)_auto]"><Select label="Αποθήκη" name="warehouse" defaultValue={warehouseId} options={warehouses.map((row): [string, string] => [row.id, row.name])} /><button type="submit" className={btn("outline")}>Ενημέρωση πρόβλεψης</button></form></Card>
      <div className="grid gap-3 md:grid-cols-3"><Card className="p-4"><p className="text-sm text-muted-foreground">Είδη με πρόταση</p><p className="mt-1 text-3xl font-semibold tabular-nums">{suggestions.length}</p></Card><Card className="p-4"><p className="text-sm text-muted-foreground">Αποθήκη</p><p className="mt-1 font-semibold">{warehouse?.name ?? "Καμία διαθέσιμη"}</p></Card><Card className="p-4"><p className="text-sm text-muted-foreground">Κανόνας</p><p className="mt-1 text-sm">Μόνο διαθέσιμες/αποδεσμευμένες παρτίδες με θετικό υπόλοιπο. Η πρόβλεψη δεν δημιουργεί αυτόματα plan.</p></Card></div>
      <Card className="overflow-x-auto"><table className="w-full min-w-[58rem] text-sm"><thead className="bg-secondary/60 text-left text-xs text-muted-foreground"><tr><th className="p-3">Είδος</th><th className="p-3 text-right">Ιστορικό 7ημ.</th><th className="p-3 text-right">Confirmed χονδρική</th><th className="p-3 text-right">Διαθέσιμο</th><th className="p-3 text-right">Προγραμμ. παραγωγή</th><th className="p-3 text-right">Πρόταση</th></tr></thead><tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.genericItemId} className="align-top"><td className="p-3"><p className="font-medium">{row.name}</p><p className="mt-1 max-w-md text-xs text-muted-foreground">{row.explanation}</p></td><td className="p-3 text-right tabular-nums">{formatStockQuantity(row.historicalForecastBase, row.dimension)}</td><td className="p-3 text-right tabular-nums">{formatStockQuantity(row.confirmedWholesaleBase, row.dimension)}</td><td className="p-3 text-right tabular-nums">{formatStockQuantity(row.availableBase, row.dimension)}</td><td className="p-3 text-right tabular-nums">{formatStockQuantity(row.plannedProductionBase, row.dimension)}</td><td className="p-3 text-right font-semibold tabular-nums"><div className="inline-flex items-center gap-2">{row.suggestedBase ? <Badge tone="warning">Παραγωγή</Badge> : <Badge tone="success">Καλύπτεται</Badge>}{formatStockQuantity(row.suggestedBase, row.dimension)}</div></td></tr>)}</tbody></table>{!rows.length ? <p className="p-5 text-sm text-muted-foreground">Δεν υπάρχουν ιστορικό, ανοιχτή χονδρική, απόθεμα ή plans για αυτή την αποθήκη.</p> : null}</Card>
    </div>
  </Page>;
}
