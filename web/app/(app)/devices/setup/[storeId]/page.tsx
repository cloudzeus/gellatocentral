import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { CircleAlert, CircleCheck, Clock, LayoutGrid, MapPin, ReceiptText, ThermometerSnowflake, type LucideIcon } from "lucide-react";
import { AddressField } from "@/components/address-field";
import { Submit } from "@/components/submit";
import { btn, Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { issuerOf } from "@/lib/documents/issuer";
import { readiness, type Check, type Tone } from "@/lib/store-setup";
import { addressGaps } from "@/lib/documents/build";
import { issuePairQr, setPrinter, setStoreAddress, setTerminal } from "../actions";

const TONE: Record<Tone, { icon: LucideIcon; cls: string; bar: string; label: string }> = {
  ok: { icon: CircleCheck, cls: "text-emerald-600", bar: "bg-emerald-600", label: "έτοιμο" },
  wait: { icon: Clock, cls: "text-amber-600", bar: "bg-amber-500", label: "περιμένει" },
  bad: { icon: CircleAlert, cls: "text-red-600", bar: "bg-red-600", label: "λείπει" },
};
const GROUP_ICON: Record<string, LucideIcon> = { sale: ReceiptText, cold: ThermometerSnowflake, tables: LayoutGrid };
const field = "h-9 rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";

export default async function StoreReadinessPage({ params }: PageProps<"/devices/setup/[storeId]">) {
  const { storeId } = await params;
  const { org, can } = await currentOrg("devices.read");
  const store = await db.store.findFirst({
    where: { id: storeId, orgId: org.id },
    include: { legalEntity: true, printers: { where: { active: true }, orderBy: { name: "asc" } }, diningTables: { where: { active: true }, select: { zone: true } }, devices: { where: { active: true }, orderBy: { createdAt: "asc" }, include: { readings: { orderBy: { at: "desc" }, take: 1 } } } },
  });
  if (!store) notFound();
  const [orgRow, products] = await Promise.all([db.organization.findUniqueOrThrow({ where: { id: org.id } }), db.product.count({ where: { orgId: org.id, active: true } })]);
  const issuer = issuerOf(orgRow, store.legalEntity);
  const now = new Date();
  const tills = store.devices.filter((d) => d.kind === "POS_ANDROID");
  const r = readiness({
    issuer: { name: issuer.name, viva: !!issuer.vivaMerchantId, mydata: !!(issuer.aadeUserId && issuer.aadeSubKey) },
    products,
    tills: tills.map((t) => ({ id: t.id, name: t.name, series: t.series, vivaTerminalId: t.vivaTerminalId, pairedAt: t.pairedAt, pairCodeLive: !!t.pairCode && !!t.pairCodeExpiresAt && t.pairCodeExpiresAt > now })),
    printers: store.printers.map((p) => ({ id: p.id, name: p.name, role: p.role, connection: p.connection, address: p.address })),
    coldDevices: store.devices.filter((d) => d.kind === "FRIDGE" || d.kind === "VENDING_MACHINE").map((d) => ({ name: d.name, vending: d.kind === "VENDING_MACHINE", tempMin: d.tempMin, tempMax: d.tempMax, lastReadingAt: d.readings[0]?.at ?? null })),
    tables: store.diningTables.length,
    zones: new Set(store.diningTables.map((t) => t.zone ?? "")).size,
  }, now);

  // QR σύνδεσης: ο server όπως τον βλέπει ο browser + ο κωδικός. Η εφαρμογή Android τα διαβάζει και συνδέεται μόνη της.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3210";
  const base = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const qr = new Map<string, { code: string; svg: string; minutes: number }>();
  for (const t of tills) {
    if (!t.pairCode || !t.pairCodeExpiresAt || t.pairCodeExpiresAt <= now) continue;
    const svg = await QRCode.toString(`${base}/api/pos/pair?code=${t.pairCode}`, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#131F3B", light: "#FFFFFF" } });
    qr.set(t.id, { code: t.pairCode, svg, minutes: Math.ceil((t.pairCodeExpiresAt.getTime() - now.getTime()) / 60_000) });
  }
  const printers = new Map(store.printers.map((p) => [p.id, p]));
  const tillById = new Map(tills.map((d) => [d.id, d]));
  const left = r.total - r.ok;
  const city = store.city || (store.cityId ? (await db.geoCity.findUnique({ where: { id: store.cityId }, select: { name: true } }))?.name : null) || "";
  const addressMissing = addressGaps({ street: store.address, city, postalCode: store.postalCode });
  const circ = 2 * Math.PI * 52;

  const action = (c: Check) => {
    const a = c.action;
    if (!a) return null;
    if (a.kind === "link") return <Link href={a.href!} className={btn("outline", "sm")}>{a.label}</Link>;
    if (!can("devices.edit")) return null;
    if (a.kind === "pair") return <form action={issuePairQr.bind(null, store.id, a.id!)}><Submit className={btn(c.tone === "ok" ? "outline" : "default", "sm")}>{a.label}</Submit></form>;
    if (a.kind === "viva") return (
      <form action={setTerminal.bind(null, store.id, a.id!)} className="flex flex-wrap gap-2">
        <input name="vivaTerminalId" inputMode="numeric" required pattern="\d{4,20}" defaultValue={tillById.get(a.id!)?.vivaTerminalId ?? ""} placeholder="Terminal ID" aria-label={`Terminal ID για ${c.title}`} className={`${field} w-32`} />
        <select name="vivaCloud" defaultValue={tillById.get(a.id!)?.vivaCloud ? "1" : ""} aria-label={`Πού πληρώνει ο πελάτης στο ${c.title}`} className={field}>
          <option value="">Στην ίδια συσκευή</option>
          <option value="1">Σε άλλο POS (π.χ. τηλέφωνο)</option>
        </select>
        <Submit className={btn(c.tone === "ok" ? "outline" : "default", "sm")}>{a.label === "Αλλαγή" ? "Αλλαγή" : "Αποθήκευση"}</Submit>
      </form>
    );
    const p = printers.get(a.id!);
    return (
      <form action={setPrinter.bind(null, store.id, a.id!)} className="flex flex-wrap gap-2">
        <select name="connection" defaultValue={p?.connection} aria-label={`Σύνδεση ${c.title}`} className={field}><option value="NETWORK">Δίκτυο</option><option value="BLUETOOTH">Bluetooth</option><option value="USB">USB</option></select>
        <input name="address" defaultValue={p?.address ?? ""} placeholder="192.168.1.40:9100" aria-label={`Διεύθυνση ${c.title}`} className={`${field} w-40`} />
        <Submit className={btn(c.tone === "ok" ? "outline" : "default", "sm")}>Αποθήκευση</Submit>
      </form>
    );
  };

  return (
    <Page section="Ταμείο & τιμολόγηση" title={`${store.name} · Ετοιμότητα`} description={left ? `Μένουν ${left} πράγματα. Ό,τι είναι πράσινο δουλεύει ήδη` : "Όλα έτοιμα"}
      actions={<Link href="/devices" className={btn("outline")}>Όλες οι συσκευές</Link>}>
      <div className="grid max-w-7xl gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <Card className="space-y-4 p-5">
          <div className="relative mx-auto size-36">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden><circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-muted" /><circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-emerald-600" strokeDasharray={`${(r.total ? r.ok / r.total : 0) * circ} ${circ}`} /></svg>
            <p className="absolute inset-0 grid place-content-center text-center"><span className="text-3xl font-semibold tabular-nums">{r.ok} / {r.total}</span><span className="text-xs text-muted-foreground">έτοιμα</span></p>
          </div>
          {r.groups.map((g) => (
            <div key={g.key} className="space-y-1">
              <p className="flex justify-between text-sm"><span>{g.title}</span><span className="tabular-nums text-muted-foreground">{g.ok} / {g.checks.length}</span></p>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${g.ok} έτοιμα, ${g.wait} περιμένουν, ${g.bad} λείπουν`}>
                {(["ok", "wait", "bad"] as const).map((t) => <span key={t} className={TONE[t].bar} style={{ width: `${(g[t] / g.checks.length) * 100}%` }} />)}
              </div>
            </div>
          ))}
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{(["ok", "wait", "bad"] as const).map((t) => <span key={t} className="flex items-center gap-1"><i className={`size-2.5 rounded-full ${TONE[t].bar}`} />{TONE[t].label}</span>)}</p>
          {tills.length ? (
            <p className={`flex items-start gap-2 rounded-lg p-3 text-sm ${r.canSell ? "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
              {r.canSell ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <Clock className="mt-0.5 size-4 shrink-0" />}
              {r.canSell ? "Το ταμείο πουλά. Ό,τι μένει δεν σταματά την πώληση" : "Πουλά όταν συνδεθεί ένα ταμείο, με εκδότη myDATA και προϊόντα"}
            </p>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="flex items-center gap-2 border-b border-border/70 px-5 py-3 font-semibold"><MapPin className="size-4" aria-hidden />Διεύθυνση σημείου</h2>
            <div className="space-y-3 px-5 py-3">
              <p className={`flex items-start gap-2 text-sm ${addressMissing.length ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                {addressMissing.length ? <Clock className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />}
                {addressMissing.length ? `Λείπει ${addressMissing.join(", ")}. Χωρίς αυτά δεν βγαίνει δελτίο αποστολής από εδώ (τόπος φόρτωσης)` : "Πλήρης· μπαίνει ως τόπος φόρτωσης στα δελτία αποστολής"}
              </p>
              <form action={setStoreAddress.bind(null, store.id)} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
                <AddressField label="Οδός και αριθμός" name="address" defaultValue={store.address ?? ""} maxLength={120} placeholder="π.χ. Κάστορος 24" disabled={!can("devices.edit")} />
                <label className="space-y-1 text-sm font-medium">Πόλη<input name="city" defaultValue={city} maxLength={80} disabled={!can("devices.edit")} className={`${field} mt-1 w-full`} /></label>
                <label className="space-y-1 text-sm font-medium">ΤΚ<input name="postalCode" defaultValue={store.postalCode ?? ""} inputMode="numeric" pattern="\d{5}" maxLength={5} disabled={!can("devices.edit")} className={`${field} mt-1 w-full`} /></label>
                {can("devices.edit") ? <Submit className={btn("outline")}>Αποθήκευση</Submit> : null}
              </form>
            </div>
          </Card>
          {r.groups.map((g) => {
            const GIcon = GROUP_ICON[g.key];
            return (
              <Card key={g.key}>
                <h2 className="flex items-center gap-2 border-b border-border/70 px-5 py-3 font-semibold"><GIcon className="size-4" aria-hidden />{g.title}</h2>
                <ul className="divide-y divide-border/70">
                  {g.checks.map((c) => {
                    const T = TONE[c.tone];
                    const code = c.action?.kind === "pair" ? qr.get(c.action.id!) : undefined;
                    return (
                      <li key={c.key} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <T.icon className={`size-5 shrink-0 ${T.cls}`} aria-label={T.label} />
                          <div className="min-w-48 flex-1"><p className="font-medium">{c.title}</p><p className="text-sm text-muted-foreground">{c.detail}</p></div>
                          {action(c)}
                        </div>
                        {code ? (
                          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl bg-primary p-4 text-primary-foreground">
                            <div className="size-36 shrink-0 rounded-lg bg-white p-1.5 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: code.svg }} />
                            <div className="min-w-48 flex-1 space-y-1 text-sm">
                              <p>Άνοιξε την εφαρμογή ταμείου στη συσκευή Android και πάτα «Σκανάρισμα QR». Αν δεν έχει κάμερα, γράψε:</p>
                              <p className="font-mono text-2xl tracking-widest">{code.code.slice(0, 4)}·{code.code.slice(4)}</p>
                              <p className="opacity-80">Λήγει σε {code.minutes}′ · μία χρήση</p>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
          <p className="text-sm text-muted-foreground">Μπορείς να φύγεις τώρα. Η λίστα μένει εδώ, από τη σελίδα «Συσκευές», μέχρι να γίνουν όλα πράσινα</p>
        </div>
      </div>
    </Page>
  );
}
