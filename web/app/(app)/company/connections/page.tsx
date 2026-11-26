import { CircleAlert, CircleCheck, Phone, PhoneMissed, ShoppingBag } from "lucide-react";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Kpi, Page, Select } from "@/components/ui";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { callsToday } from "@/lib/orders";
import { athensDayRange } from "@/lib/production-day-close";
import { requireStockContext } from "@/lib/stock-context";
import { saveExtensions, saveYeastar, testCall, testPlatformOrder } from "./actions";

// Ρυθμίσεις › Συνδέσεις: τηλεφωνικό κέντρο Yeastar (αναγνώριση πελάτη στην κλήση) και πλατφόρμες παραγγελιών.
// Ύφος: docs/mockups/central-till/orders-callerid.html καρέ 7.
export default async function ConnectionsPage() {
  const ctx = await requireStockContext("users.edit");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
  const { start, end } = athensDayRange(today);
  const [yeastar, tills, stores, calls, appUrl] = await Promise.all([
    db.integration.findUnique({ where: { orgId_kind: { orgId: ctx.orgId, kind: "YEASTAR" } } }),
    db.device.findMany({ where: { orgId: ctx.orgId, kind: { in: ["POS_ANDROID", "POS_WEB"] }, active: true }, orderBy: [{ store: { name: "asc" } }, { name: "asc" }], select: { id: true, name: true, pbxExtension: true, store: { select: { name: true } } } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    callsToday(ctx.orgId, start, end),
    setting("APP_URL"),
  ]);
  const webhook = yeastar ? `${appUrl || "https://<διεύθυνση εφαρμογής>"}/api/webhooks/yeastar/${yeastar.id}` : null;
  // ώρες λειτουργίας στο γράφημα: 08:00–23:00, και όποια άλλη ώρα είχε κλήση
  const hours = calls.hours.filter((h) => (h.hour >= 8 && h.hour <= 23) || h.answered + h.missed);
  const max = Math.max(1, ...hours.map((h) => h.answered + h.missed));
  const connected = !!yeastar?.enabled && !!yeastar.lastEventAt;

  return (
    <Page section="Ρυθμίσεις" title="Συνδέσεις" description="Τηλεφωνικό κέντρο και πλατφόρμες παραγγελιών. Τα κλειδιά μπαίνουν εδώ και δεν φαίνονται ξανά.">
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi icon={Phone} label="Κλήσεις σήμερα" value={calls.total} hint={calls.total ? "Η καρτέλα του πελάτη άνοιξε στο ταμείο" : "Καμία κλήση ακόμα"} />
          <Kpi icon={PhoneMissed} label="Αναπάντητες" value={calls.missed} tone={calls.missed ? "warning" : "success"} hint={calls.missed ? "Πάρε πίσω: φαίνονται στις Παραγγελίες του ταμείου" : "Όλες απαντήθηκαν"} />
          <Kpi icon={ShoppingBag} label="Έγιναν παραγγελία" value={calls.orders} tone={calls.orders ? "success" : "neutral"} hint={calls.total ? `${Math.round((calls.orders / calls.total) * 100)}% των κλήσεων` : undefined} />
        </div>

        <Card className="p-5">
          <h2 className="font-semibold">Κλήσεις ανά ώρα</h2>
          <p className="text-muted-foreground">Πράσινο: απαντήθηκαν. Πορτοκαλί: αναπάντητες.</p>
          <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label={`Κλήσεις σήμερα ανά ώρα: ${hours.map((h) => `${h.hour}:00 ${h.answered} απαντημένες, ${h.missed} αναπάντητες`).join("· ")}`}>
            {hours.map((h) => (
              <div key={h.hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-2xs tabular-nums text-muted-foreground">{h.answered + h.missed || ""}</span>
                <div className="flex w-full max-w-8 flex-col justify-end overflow-hidden rounded-sm" style={{ height: `${((h.answered + h.missed) / max) * 100}%` }}>
                  <div className="bg-warning" style={{ flex: h.missed }} />
                  <div className="bg-success" style={{ flex: h.answered }} />
                </div>
                <span className="text-2xs tabular-nums text-muted-foreground">{String(h.hour).padStart(2, "0")}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="grid gap-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex-1 font-semibold">Τηλεφωνικό κέντρο Yeastar</h2>
              {connected ? <Badge tone="success" icon={CircleCheck}>Λαμβάνει κλήσεις</Badge> : yeastar?.enabled ? <Badge tone="warning" icon={CircleAlert}>Δεν ήρθε ακόμα κλήση</Badge> : <Badge>Ανενεργό</Badge>}
            </div>
            <p className="text-muted-foreground">Μόνο P-Series. Στο τηλεφωνικό κέντρο: Integrations › API, ενεργοποίηση, και «Call Status Monitor» στις γραμμές.</p>
            <form action={saveYeastar} className="grid gap-3">
              <Field label="Διεύθυνση τηλεφωνικού κέντρου" name="baseUrl" defaultValue={yeastar?.baseUrl ?? ""} placeholder="https://epic.ras.yeastar.com" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client ID" name="clientId" defaultValue={yeastar?.clientId ?? ""} autoComplete="off" />
                <Field label="Client Secret" name="clientSecret" type="password" autoComplete="new-password" placeholder={yeastar?.clientSecret ? "•••••••• (μένει όπως είναι)" : ""} />
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={yeastar?.enabled ?? false} className="size-4" /> Ενεργή σύνδεση</label>
              <Submit className={btn("default", "default", "justify-self-start")} pendingText="Αποθήκευση…">Αποθήκευση</Submit>
            </form>
            {webhook ? (
              <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-4">
                <p className="font-medium">Γράψε στο τηλεφωνικό κέντρο (API › Webhook):</p>
                <p className="text-muted-foreground">URL</p><code className="break-all text-xs">{webhook}</code>
                <p className="text-muted-foreground">Secret</p><code className="break-all text-xs">{yeastar!.webhookSecret}</code>
                <p className="text-muted-foreground">Γεγονότα: 30011 (αλλαγή κατάστασης κλήσης) και 30012 (τέλος κλήσης). Ο server πρέπει να φαίνεται από το internet με https.</p>
                {yeastar!.lastEventAt ? <p className="text-success-ink">Τελευταίο γεγονός: {yeastar!.lastEventAt.toLocaleString("el-GR", { timeZone: "Europe/Athens" })}</p> : null}
              </div>
            ) : <p className="text-muted-foreground">Μετά την πρώτη αποθήκευση εμφανίζεται εδώ η διεύθυνση για το webhook.</p>}
          </Card>

          <Card className="grid content-start gap-4 p-5">
            <h2 className="font-semibold">Ποιο ταμείο ανοίγει την καρτέλα</h2>
            <p className="text-muted-foreground">Γράψε το εσωτερικό που χτυπά σε κάθε ταμείο. Κλήση σε εσωτερικό χωρίς ταμείο φαίνεται σε όλα τα ταμεία.</p>
            {tills.length ? (
              <form action={saveExtensions} className="grid gap-3">
                {tills.map((d) => (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">{d.store.name} · {d.name}</span>
                    <input name={`ext_${d.id}`} defaultValue={d.pbxExtension ?? ""} inputMode="numeric" placeholder="π.χ. 201" aria-label={`Εσωτερικό για ${d.store.name} ${d.name}`} className="h-9 w-28 rounded-md border border-input bg-background px-3 tabular-nums" />
                  </div>
                ))}
                <Submit className={btn("outline", "default", "justify-self-start")} pendingText="Αποθήκευση…">Αποθήκευση εσωτερικών</Submit>
              </form>
            ) : <p className="text-warning-ink">Δεν υπάρχει ενεργό ταμείο.</p>}
            <form action={testCall} className="grid gap-3 border-t border-border pt-4">
              <p className="font-medium">Δοκιμή χωρίς τηλεφωνικό κέντρο</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Τηλέφωνο καλούντα" name="phone" inputMode="tel" placeholder="6944123456" />
                <Select label="Εσωτερικό" name="extension" options={[["", "Όλα τα ταμεία"], ...tills.filter((d) => d.pbxExtension).map((d): [string, string] => [d.pbxExtension!, `${d.pbxExtension} · ${d.name}`])]} />
              </div>
              <Submit className={btn("outline", "default", "justify-self-start")} pendingText="Αποστολή…">Στείλε δοκιμαστική κλήση</Submit>
            </form>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {(["WOLT", "EFOOD"] as const).map((source) => (
            <Card key={source} className="grid content-start gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex-1 font-semibold">{source === "WOLT" ? "Wolt" : "efood"}</h2>
                <Badge tone="warning" icon={CircleAlert}>Περιμένει έγκριση συνεργάτη</Badge>
              </div>
              <p className="text-muted-foreground">
                {source === "WOLT"
                  ? "Η Wolt δίνει κλειδιά μόνο σε εγκεκριμένους συνεργάτες: αίτηση, δοκιμαστικό περιβάλλον, πιλοτικό κατάστημα. Μετά οι παραγγελίες έρχονται εδώ μόνες τους."
                  : "Το efood συνδέεται μέσω της υπηρεσίας ταμείων της Delivery Hero. Η αίτηση γίνεται με τον υπεύθυνο λογαριασμού του efood."}
              </p>
              <p className="text-muted-foreground">Ως τότε, δες πώς δουλεύει η αποδοχή στο ταμείο με μια δοκιμαστική παραγγελία.</p>
              <form action={testPlatformOrder} className="grid gap-3">
                <input type="hidden" name="source" value={source} />
                {stores.length > 1 ? <Select label="Κατάστημα" name="storeId" options={stores.map((s): [string, string] => [s.id, s.name])} /> : null}
                <label className="flex items-center gap-2"><input type="checkbox" name="cash" className="size-4" /> Πληρωμή με μετρητά στην πόρτα (αλλιώς πληρωμένη online)</label>
                <Submit className={btn("outline", "default", "justify-self-start")} pendingText="Αποστολή…">Στείλε δοκιμαστική παραγγελία</Submit>
              </form>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}
