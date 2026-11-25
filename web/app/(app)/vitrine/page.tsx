import { MonitorSmartphone, RefreshCw, Settings2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { VitrineTokenForm } from "@/components/vitrine-token-form";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { saveVitrine, saveVitrineItem, syncVitrine } from "./actions";

const day = (value: Date) => new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens" }).format(value);

export default async function VitrinePage({ searchParams }: PageProps<"/vitrine">) {
  const ctx = await requireStockContext("vitrine.read");
  const query = await searchParams;
  const [stores, warehouses] = await Promise.all([
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : ctx.warehouseIds.length ? { id: { in: [] } } : {}) }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: warehouseScopeWhere(ctx), include: { stores: true }, orderBy: { name: "asc" } }),
  ]);
  const [settings, views] = await Promise.all([
    db.vitrineSetting.findMany({ where: { orgId: ctx.orgId, storeId: { in: stores.map((store) => store.id) } }, include: { items: { orderBy: { position: "asc" } } } }),
    db.vitrineDailyView.findMany({ where: { orgId: ctx.orgId, storeId: { in: stores.map((store) => store.id) } }, orderBy: { viewedOn: "desc" }, take: 90 }),
  ]);
  const products = await db.product.findMany({ where: { orgId: ctx.orgId, id: { in: settings.flatMap((setting) => setting.items.map((item) => item.productId)) } }, select: { id: true, name: true, priceCents: true } });
  const productById = new Map(products.map((product) => [product.id, product]));
  const canEdit = ctx.can("vitrine.edit");

  return <Page section="Πελάτες & πωλήσεις" title="Δημόσια βιτρίνα" description="QR/TV προϊόντα, snapshots αλλεργιογόνων και διαθεσιμότητα από το απόθεμα">
    <div className="grid max-w-7xl gap-4">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}{typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
      {stores.map((store) => {
        const setting = settings.find((row) => row.storeId === store.id) ?? null;
        const storeWarehouses = warehouses.filter((warehouse) => warehouse.stores.some((link) => link.storeId === store.id));
        const storeViews = views.filter((view) => view.storeId === store.id);
        return <Card key={store.id} className="overflow-hidden"><div className="flex flex-wrap items-center gap-3 border-b border-border p-4"><MonitorSmartphone className="size-5 text-muted-foreground" /><div className="min-w-0 flex-1"><h2 className="font-semibold">{store.name}</h2><p className="text-xs text-muted-foreground">{setting ? `${setting.selectionMode === "auto" ? "Αυτόματη διαθεσιμότητα" : "Χειροκίνητη επιλογή"} · ${setting.items.filter((item) => item.selected && !item.soldOut).length} εμφανή · ${storeViews.reduce((sum, view) => sum + view.views, 0)} προβολές` : "Δεν έχει ρυθμιστεί"}</p></div>{setting ? <Badge tone={setting.published ? "success" : "warning"}>{setting.published ? "Δημοσιευμένη" : "Πρόχειρη"}</Badge> : null}{canEdit ? <><Modal label={<><Settings2 /> Ρυθμίσεις</>} title={`Βιτρίνα · ${store.name}`}><form action={saveVitrine} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="storeId" value={store.id} /><Select label="Επιλογή προϊόντων" name="selectionMode" defaultValue={setting?.selectionMode ?? "manual"} options={[["manual", "Χειροκίνητη"], ["auto", "Απόθεμα αυτόματα"]]} /><Select label="Αποθήκη διαθεσιμότητας" name="warehouseId" defaultValue={setting?.warehouseId ?? ""} options={[["", "Χωρίς / χειροκίνητη"], ...storeWarehouses.map((warehouse): [string, string] => [warehouse.id, warehouse.name])]} /><Field label="Δευτερόλεπτα ανά TV σελίδα" name="tvPageSeconds" type="number" min={3} max={300} defaultValue={setting?.tvPageSeconds ?? 12} required /><fieldset className="flex flex-wrap items-end gap-3 pb-2 text-sm"><legend className="text-xs font-medium">Γλώσσες</legend>{[["el", "Ελληνικά"], ["en", "English"], ["it", "Italiano"]].map(([value, label]) => <label key={value} className="flex items-center gap-1"><input type="checkbox" name="languages" value={value} defaultChecked={setting?.languages.includes(value) ?? value === "el"} />{label}</label>)}</fieldset><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showPrices" defaultChecked={setting?.showPrices ?? true} />Τιμές</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showAllergens" defaultChecked={setting?.showAllergens ?? true} />Αλλεργιογόνα</label><label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="published" defaultChecked={setting?.published ?? false} />Δημοσίευση στον δημόσιο σύνδεσμο</label><Submit className={btn("default", "default", "sm:col-span-2")}>Αποθήκευση & συγχρονισμός</Submit></form></Modal>{setting ? <><form action={syncVitrine.bind(null, store.id)}><Submit className={btn("outline", "sm")}><RefreshCw /> Συγχρονισμός</Submit></form><VitrineTokenForm storeId={store.id} /></> : null}</> : null}</div>
          {setting ? <div className="overflow-x-auto"><table className="w-full min-w-180 text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="p-3">Προϊόν</th><th className="p-3">Θέση</th><th className="p-3">Τιμή €</th><th className="p-3">Εμφάνιση</th><th className="p-3">Sold out</th><th className="p-3"></th></tr></thead><tbody>{setting.items.map((item) => { const product = productById.get(item.productId); return <tr key={item.id} className="border-b border-border/60 last:border-0"><td className="p-3"><strong>{product?.name ?? "Ανενεργό προϊόν"}</strong><span className="block text-xs text-muted-foreground">{product ? `Τιμή καταλόγου ${euro(product.priceCents)}` : "Δεν εμφανίζεται δημόσια"}</span></td><td className="p-2" colSpan={5}>{canEdit ? <form action={saveVitrineItem} className="grid grid-cols-[4rem_6rem_5rem_5rem_auto] items-center gap-2"><input type="hidden" name="itemId" value={item.id} /><input aria-label="Θέση" name="position" type="number" min={0} defaultValue={item.position} className="h-8 rounded border border-input bg-card px-1" /><input aria-label="Τιμή βιτρίνας" name="price" inputMode="decimal" defaultValue={item.priceCents == null ? "" : (item.priceCents / 100).toFixed(2)} placeholder={product ? (product.priceCents / 100).toFixed(2) : ""} className="h-8 rounded border border-input bg-card px-1" /><label className="flex items-center gap-1"><input type="checkbox" name="selected" defaultChecked={item.selected} disabled={setting.selectionMode === "auto"} />Ναι</label><label className="flex items-center gap-1"><input type="checkbox" name="soldOut" defaultChecked={item.soldOut} disabled={setting.selectionMode === "auto"} />Ναι</label><Submit className={btn("ghost", "sm")}>Αποθήκευση</Submit></form> : <span className="text-muted-foreground">Μόνο προβολή</span>}</td></tr>; })}</tbody></table>{!setting.items.length ? <p className="p-6 text-center text-sm text-muted-foreground">Πάτησε «Συγχρονισμός» για να δημιουργηθούν τα snapshots προϊόντων.</p> : null}</div> : null}
          {storeViews.length ? <div className="border-t border-border p-4"><h3 className="text-xs font-semibold text-muted-foreground">Πρόσφατες ανώνυμες προβολές</h3><div className="mt-2 flex flex-wrap gap-2">{storeViews.slice(0, 14).map((view) => <Badge key={view.id}>{day(view.viewedOn)} · {view.views}</Badge>)}</div></div> : null}
        </Card>;
      })}
      {!stores.length ? <Card className="p-6 text-sm text-muted-foreground">Δεν υπάρχει διαθέσιμο κατάστημα στο δικαίωμά σου.</Card> : null}
    </div>
  </Page>;
}
