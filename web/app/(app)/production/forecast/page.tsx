import Link from "next/link";
import { ArrowLeft, CalendarClock, CircleCheck, Factory } from "lucide-react";
import { btn, Card, Kpi, Page, Select } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { db } from "@/lib/db";
import { productionForecast } from "@/lib/forecast-db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { formatStockQuantity } from "@/lib/stock-view";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

export default async function ProductionForecastPage({ searchParams }: PageProps<"/production/forecast">) {
  const ctx = await requireStockContext("production.read");
  const q = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (typeof q.warehouse === "string" && !warehouses.some((warehouse) => warehouse.id === q.warehouse)) notFound();
  const warehouseId = typeof q.warehouse === "string" ? q.warehouse : warehouses[0]?.id;
  const rows = warehouseId ? await productionForecast(db, ctx, warehouseId) : [];
  const suggestions = rows.filter((row) => row.suggestedBase > 0).sort((a, b) => b.suggestedBase - a.suggestedBase || a.name.localeCompare(b.name, "el"));
  const warehouse = warehouses.find((row) => row.id === warehouseId);
  const covered = rows.length - suggestions.length;
  return <Page section="Παραγωγή" title="Πρόβλεψη 7 ημερών" description="Τι πρέπει να παραχθεί: πωλήσεις 28 ημερών και επιβεβαιωμένη χονδρική, μείον απόθεμα και ό,τι είναι ήδη προγραμματισμένο" actions={<div className="flex gap-2"><Link href="/production/plans" className={btn("outline", "sm")}><CalendarClock /> Προγραμματισμός</Link><Link href="/production" className={btn("outline", "sm")}><ArrowLeft /> Παρτίδες</Link></div>}>
    <div className="grid max-w-7xl gap-4">
      {warehouses.length > 1 ? <form className="flex flex-wrap items-end gap-3"><div className="w-full max-w-xs"><Select label="Αποθήκη" name="warehouse" defaultValue={warehouseId} options={warehouses.map((row): [string, string] => [row.id, row.name])} /></div><button type="submit" className={btn("outline")}>Προβολή</button></form> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Kpi icon={Factory} label="Χρειάζονται παραγωγή" value={suggestions.length} tone={suggestions.length ? "warning" : "success"} hint={suggestions.length ? "Πρόσθεσέ τα στον προγραμματισμό της εβδομάδας" : "Το απόθεμα καλύπτει τη ζήτηση"} />
        <Kpi icon={CircleCheck} label="Καλύπτονται" value={covered} tone={covered ? "success" : "neutral"} hint="Αρκεί το απόθεμα και ό,τι είναι προγραμματισμένο" />
        <Kpi icon={CalendarClock} label="Αποθήκη" value={<span className="text-xl">{warehouse?.name ?? "Καμία"}</span>} hint="Μετράνε μόνο διαθέσιμες παρτίδες με υπόλοιπο. Η πρόβλεψη δεν φτιάχνει πλάνο μόνη της." />
      </div>
      <Card><DataTable id="production-forecast" empty={<p>Δεν υπάρχουν πωλήσεις, ανοιχτή χονδρική, απόθεμα ή πλάνα για αυτή την αποθήκη.</p>}
        columns={[{ key: "name", label: "Είδος", required: true }, { key: "status", label: "Κατάσταση" }, { key: "suggested", label: "Να παραχθούν", numeric: true }, { key: "history", label: "Πωλήσεις 7ημ.", numeric: true }, { key: "wholesale", label: "Χονδρική", numeric: true }, { key: "available", label: "Απόθεμα", numeric: true }, { key: "planned", label: "Προγραμματισμένα", numeric: true, narrowHidden: true }]}
        rows={[...suggestions, ...rows.filter((row) => !row.suggestedBase)].map((row) => ({ id: row.genericItemId, cells: {
          name: <span className="font-medium" title={row.explanation}>{row.name}</span>,
          status: <StatusBadge look={row.suggestedBase ? look("warning", "Να παραχθεί") : look("success", "Καλύπτεται")} />,
          suggested: <strong className={row.suggestedBase ? "text-warning-ink" : "text-muted-foreground"}>{formatStockQuantity(row.suggestedBase, row.dimension)}</strong>,
          history: formatStockQuantity(row.historicalForecastBase, row.dimension), wholesale: formatStockQuantity(row.confirmedWholesaleBase, row.dimension),
          available: formatStockQuantity(row.availableBase, row.dimension), planned: formatStockQuantity(row.plannedProductionBase, row.dimension),
        } }))} /></Card>
    </div>
  </Page>;
}
