import Link from "next/link";
import { ListChecks, Plus, Store as StoreIcon } from "lucide-react";
import { Modal } from "@/components/modal";
import { btn, Card, Page, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { DEVICE_KIND, FOR, KIND_OPTIONS, readingStatus } from "@/lib/devices";
import { currentOrg } from "@/lib/auth";
import { addDevice, moveDevice, toggleDevice } from "./actions";
import { Submit } from "@/components/submit";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";

const field = "h-8.5 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });

export default async function DevicesPage() {
  const { org, can } = await currentOrg("devices.read");
  const stores = await db.store.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" }, include: { devices: { orderBy: { createdAt: "asc" }, include: { readings: { orderBy: { at: "desc" }, take: 1 } } } } });
  const [accesses, accessTotal] = await Promise.all([
    db.remoteAccess.findMany({ where: { orgId: org.id }, orderBy: { at: "desc" }, take: 20, include: { device: { select: { name: true } } } }),
    db.remoteAccess.count({ where: { orgId: org.id } }),
  ]);
  return (
    <Page section="Ταμείο & τιμολόγηση" title="Συσκευές" description={`Ταμεία, οθόνες κουζίνας, ψυγεία, αυτόματοι πωλητές και ζυγαριές. Κάθε ενεργή συσκευή χρεώνεται με την τιμή του πακέτου σου (βλ. Συνδρομή)`}
      actions={
        can("devices.add") ? (
        <>
        <Link href="/devices/setup" className={btn("outline")}><StoreIcon /> Νέο σημείο</Link>
        <Modal label={<><Plus /> Νέα συσκευή</>} variant="default" title="Νέα συσκευή" description="Η τιμή της εξαρτάται από το είδος και το πακέτο σου. Τη βλέπεις στη Συνδρομή">
          <form action={addDevice} data-by-kind className="grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end">
            <label className="block space-y-1 text-sm font-medium">Όνομα<input name="name" required minLength={2} maxLength={40} placeholder="π.χ. Ταμείο 2" className={field} /></label>
            <Select label="Κατάστημα" name="storeId" className={field} options={stores.map((s): [string, string] => [s.id, s.name])} />
            <Select label="Είδος" name="kind" className={field} options={KIND_OPTIONS} />
            <label data-for={FOR.invoicing} className="space-y-1 text-sm font-medium">Σειρά αποδείξεων<input name="series" pattern="[A-Za-z0-9]{1,6}" placeholder="π.χ. A2" className={field} /></label>
            <label data-for={FOR.invoicing} className="space-y-1 text-sm font-medium">Τερματικό Viva (προαιρετικό)<input name="vivaTerminalId" maxLength={20} placeholder="π.χ. 16000010" className={field} /></label>
            <label data-for={FOR.storage} className="space-y-1 text-sm font-medium">Κάτω όριο θερμοκρασίας (°C)<input name="tempMin" inputMode="decimal" placeholder="π.χ. -25" className={field} /></label>
            <label data-for={FOR.storage} className="space-y-1 text-sm font-medium">Πάνω όριο θερμοκρασίας (°C)<input name="tempMax" inputMode="decimal" placeholder="π.χ. -15" className={field} /></label>
            <Submit className={btn("default")}>Προσθήκη συσκευής</Submit>
          </form>
        </Modal>
        </>
        ) : null
      }>
        <div className="max-w-7xl space-y-4">
          {stores.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4"><h2 className="flex-1 text-lg">{s.name}</h2><Link href={`/devices/setup/${s.id}`} className={btn("outline", "sm")}><ListChecks /> Ετοιμότητα</Link></div>
              <ul className="divide-y divide-border/70">
                {s.devices.length === 0 ? <li className="px-5 py-6 text-muted-foreground">Κανένα ταμείο ακόμα σε αυτό το κατάστημα</li> : null}
                {s.devices.map((d) => {
                  const kind = DEVICE_KIND[d.kind];
                  const status = kind.measures ? readingStatus(d, d.readings[0]) : null;
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{[kind.label, kind.invoices && `σειρά ${d.series} · επόμενη #${d.nextAa}`, kind.invoices && (d.vivaTerminalId ? `τερματικό ${d.vivaTerminalId}` : "χωρίς τερματικό Viva"), kind.storage && (d.tempMin !== null || d.tempMax !== null) && `όρια ${d.tempMin ?? "…"} έως ${d.tempMax ?? "…"} °C`].filter(Boolean).join(" · ")}</p>
                      </div>
                      {kind.invoices ? <p className="w-full text-xs text-muted-foreground sm:order-last" title="Η MAC δεν διαβάζεται σε Android 10 και νεότερα· η συσκευή αναγνωρίζεται από το Android ID, που αλλάζει μόνο με επαναφορά εργοστασιακών ρυθμίσεων">{d.androidId ? <>Ταυτότητα συσκευής <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{d.androidId.match(/.{1,4}/g)?.join(" ")}</code>{d.lastSeenAt ? ` · τελευταία επαφή ${when.format(d.lastSeenAt)}` : ""}</> : "Η συσκευή δεν έχει συνδεθεί ακόμα με την εφαρμογή"}</p> : null}
                      {status ? <StatusBadge look={look(status.tone, status.text)} /> : null}
                      <StatusBadge look={look(d.active ? "success" : "neutral", !d.active ? "Ανενεργή" : kind.invoices ? "Ενεργή — χρεώνεται" : "Ενεργή — χωρίς χρέωση")} />
                      {can("devices.edit") && kind.invoices && stores.length > 1 ? (
                        <Modal size="sm" label="Αλλαγή καταστήματος" title={`Σε ποιο κατάστημα είναι το «${d.name}»;`} description="Όταν η συσκευή μεταφέρεται σε άλλο μαγαζί. Η σειρά αποδείξεων μένει ίδια.">
                          <form action={moveDevice.bind(null, d.id)} className="grid gap-3">
                            <Select label="Κατάστημα" name="storeId" defaultValue={s.id} className={field} options={stores.filter((x) => x.active).map((x): [string, string] => [x.id, x.name])} />
                            <Submit className={btn("default")}>Μεταφορά</Submit>
                          </form>
                        </Modal>
                      ) : null}
                      {can("devices.edit") ? <form action={toggleDevice.bind(null, d.id)}><Submit className={btn("outline", "sm")}>{d.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}

          <Card>
            <div className="border-b border-border/70 px-5 py-4">
              <h2 className="text-lg">Απομακρυσμένες συνδέσεις της υποστήριξης</h2>
              <p className="text-sm text-muted-foreground">Κάθε φορά που κάποιος από την υποστήριξη συνδέεται σε συσκευή σου, γράφεται εδώ. Η σύνδεση ανοίγει μόνο αφού πατήσεις «Αποδοχή» στη συσκευή</p>
            </div>
            {accesses.length === 0 ? <p className="px-5 py-6 text-muted-foreground">Καμία σύνδεση μέχρι τώρα</p> : (
              <ul className="divide-y divide-border/70">
                {accesses.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
                    <span className="w-36 shrink-0 text-muted-foreground tabular-nums">{when.format(a.at)}</span>
                    <span className="min-w-0 flex-1"><span className="font-medium">{a.device.name}</span> · {a.reason}</span>
                    <span className="text-muted-foreground">{a.startedByName}</span>
                  </li>
                ))}
              </ul>
            )}
            {accessTotal > accesses.length ? <p className="border-t border-border/70 px-5 py-2.5 text-xs text-muted-foreground">Εμφανίζονται οι {accesses.length} πιο πρόσφατες από {accessTotal}</p> : null}
          </Card>
        </div>
    </Page>
  );
}
