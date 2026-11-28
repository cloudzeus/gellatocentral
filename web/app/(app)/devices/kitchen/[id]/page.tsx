import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { btn, Card, Page } from "@/components/ui";
import { Submit } from "@/components/submit";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { kitchenToday } from "@/lib/kitchen";
import { saveKitchen } from "../../actions";

// Οθόνη κουζίνας στη web: σταθμός ανά κατηγορία, όρια χρόνου, και πώς πήγε η κουζίνα σήμερα (mockup kitchen-display.html, καρέ 3).
const field = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm pointer-coarse:h-11";
const STATIONS: [string, string][] = [["KITCHEN", "Κουζίνα"], ["BAR", "Bar"], ["", "Πουθενά"]];
const mm = (m: number) => `${Math.round(m)}′`;

function Pills({ name, value, disabled }: { name: string; value: string; disabled?: boolean }) {
  return (
    <span role="radiogroup" className="inline-flex rounded-lg bg-muted p-0.5">
      {STATIONS.map(([v, label]) => (
        <label key={v} className="cursor-pointer has-checked:bg-primary has-checked:text-primary-foreground rounded-md px-3 py-1.5 text-[length:var(--fs-13)] font-semibold text-muted-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring pointer-coarse:py-2.5">
          <input type="radio" name={name} value={v} defaultChecked={value === v} disabled={disabled} className="sr-only" />{label}
        </label>
      ))}
    </span>
  );
}

/** Μέσος χρόνος ανά ώρα με γραμμή στόχου· η ώρα που ξεπέρασε τον στόχο σε κόκκινο. */
function HourChart({ data, target }: { data: { hour: number; avgMin: number; count: number }[]; target: number }) {
  const W = 720, H = 200, L = 40, B = 170, top = 20;
  const max = Math.max(target * 1.5, ...data.map((d) => d.avgMin));
  const y = (m: number) => B - ((B - top) * m) / max;
  const bw = Math.min(56, (W - L - 20) / data.length - 12);
  const ticks = [0, Math.round(max / 3), Math.round((2 * max) / 3), Math.round(max)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Μέσος χρόνος ανά ώρα· στόχος ${target} λεπτά`}>
      {ticks.map((tk) => <g key={tk}><line x1={L} x2={W - 10} y1={y(tk)} y2={y(tk)} className="stroke-border" /><text x={L - 8} y={y(tk) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{tk}′</text></g>)}
      <line x1={L} x2={W - 10} y1={y(target)} y2={y(target)} strokeDasharray="5 4" className="stroke-emerald-700" />
      <text x={W - 12} y={y(target) - 6} textAnchor="end" className="fill-emerald-700 text-[11px]">στόχος {target}′</text>
      {data.map((d, i) => {
        const x = L + 16 + i * ((W - L - 20) / data.length);
        const over = d.avgMin > target;
        return (
          <g key={d.hour}>
            <rect x={x} y={y(d.avgMin)} width={bw} height={B - y(d.avgMin)} rx={4} className={over ? "fill-red-700" : "fill-slate-300"}><title>{`${d.hour}:00 · ${mm(d.avgMin)} · ${d.count} δελτία`}</title></rect>
            {over ? <text x={x + bw / 2} y={y(d.avgMin) - 6} textAnchor="middle" className="fill-red-700 text-[11px] font-semibold">{mm(d.avgMin)}</text> : null}
            <text x={x + bw / 2} y={B + 18} textAnchor="middle" className="fill-muted-foreground text-[11px]">{String(d.hour).padStart(2, "0")}:00</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function KitchenDevicePage({ params }: PageProps<"/devices/kitchen/[id]">) {
  const { org, can } = await currentOrg("devices.read");
  const device = await db.device.findFirst({ where: { id: (await params).id, orgId: org.id, kind: "KITCHEN_DISPLAY" }, include: { store: { select: { id: true, name: true } } } });
  if (!device) notFound();
  const [cats, today] = await Promise.all([
    db.category.findMany({ where: { orgId: org.id }, orderBy: { position: "asc" }, select: { id: true, name: true, station: true, _count: { select: { products: true } } } }),
    kitchenToday({ org, store: device.store }, device.station, device.kdsLateMin),
  ]);
  const edit = can("devices.edit");
  const worst = today.byHour.reduce<(typeof today.byHour)[number] | null>((w, h) => (!w || h.avgMin > w.avgMin ? h : w), null);
  const routed = cats.filter((c) => c.station).length;
  return (
    <Page section="Ταμείο & τιμολόγηση" title={`Οθόνη κουζίνας · ${device.name}`} description={`${device.store.name}. Τι δείχνει η οθόνη και πότε ένα δελτίο αργεί. Η οθόνη δεν εκδίδει παραστατικά και δεν χρεώνεται`}
      actions={<Link href="/devices" className={btn("outline")}><ArrowLeft /> Συσκευές</Link>}>
      <div className="max-w-4xl space-y-4">
        <form action={saveKitchen.bind(null, device.id)}>
          <Card>
            <div className="border-b border-border/70 px-5 py-4">
              <h2 className="text-lg">Σταθμός ανά κατηγορία</h2>
              <p className="text-sm text-muted-foreground">Σε ποια οθόνη πάει κάθε είδος. «Πουθενά» για ό,τι σερβίρεται χωρίς κουζίνα, π.χ. παγωτό από τη βιτρίνα. Ισχύει για όλα τα καταστήματα</p>
              {routed === 0 ? <p className="mt-2 text-sm font-medium text-amber-700">Καμία κατηγορία δεν πάει ακόμα σε οθόνη: η οθόνη θα μένει άδεια ώσπου να διαλέξεις</p> : null}
            </div>
            <ul className="divide-y divide-border/70">
              {cats.length === 0 ? <li className="px-5 py-6 text-muted-foreground">Δεν υπάρχουν κατηγορίες ακόμα· φτιάξε τες στα Προϊόντα</li> : null}
              {cats.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1">{c.name} <span className="text-muted-foreground tabular-nums">· {c._count.products} είδη</span></span>
                  <Pills name={`cat-${c.id}`} value={c.station ?? ""} disabled={!edit} />
                </li>
              ))}
            </ul>
            <div className="grid gap-4 border-t border-border/70 px-5 py-4 sm:grid-cols-3">
              <label className="space-y-1 text-sm font-medium">Η οθόνη δείχνει
                <select name="station" defaultValue={device.station ?? ""} disabled={!edit} className={field}><option value="KITCHEN">Κουζίνα</option><option value="BAR">Bar</option><option value="">Όλους τους σταθμούς</option></select>
              </label>
              <label className="space-y-1 text-sm font-medium">Κίτρινο μετά από (λεπτά)<input name="kdsWarnMin" type="number" min={1} max={120} required defaultValue={device.kdsWarnMin} disabled={!edit} className={field} /></label>
              <label className="space-y-1 text-sm font-medium">Κόκκινο μετά από (λεπτά)<input name="kdsLateMin" type="number" min={1} max={120} required defaultValue={device.kdsLateMin} disabled={!edit} className={field} /></label>
            </div>
            {edit ? <div className="flex justify-end border-t border-border/70 px-5 py-3"><Submit className={btn("default")}>Αποθήκευση</Submit></div> : null}
          </Card>
        </form>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Σήμερα στην κουζίνα</h2><p className="text-sm text-muted-foreground">Από την αποστολή του σερβιτόρου ως το «Έτοιμο»</p></div>
          {today.count === 0 ? <p className="px-5 py-6 text-muted-foreground">Κανένα δελτίο δεν βγήκε ακόμα σήμερα. Τα νούμερα εμφανίζονται με το πρώτο «Έτοιμο»</p> : (
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/70 px-4 py-3"><b className="block text-2xl font-semibold tabular-nums">{today.count}</b><span className="text-sm text-muted-foreground">δελτία βγήκαν</span></div>
                <div className="rounded-xl border border-border/70 px-4 py-3"><b className="block text-2xl font-semibold tabular-nums">{mm(today.avgMin)}</b><span className="text-sm text-muted-foreground">μέσος χρόνος · {today.avgMin <= device.kdsWarnMin ? <span className="font-semibold text-emerald-700">εντός στόχου {device.kdsWarnMin}′</span> : <span className="font-semibold text-red-700">πάνω από τον στόχο {device.kdsWarnMin}′</span>}</span></div>
                <div className="rounded-xl border border-border/70 px-4 py-3"><b className="block text-2xl font-semibold tabular-nums">{today.late}</b><span className="text-sm text-muted-foreground">πάνω από {device.kdsLateMin}′{today.late ? "" : " · κανένα"}</span></div>
              </div>
              <HourChart data={today.byHour} target={device.kdsWarnMin} />
              <p className="text-sm text-muted-foreground">{worst && worst.avgMin > device.kdsWarnMin ? `Στις ${String(worst.hour).padStart(2, "0")}:00 η κουζίνα ξεπέρασε τον στόχο (${mm(worst.avgMin)} κατά μέσο όρο). Εκεί θα βοηθούσε ένα άτομο ακόμα.` : "Όλες οι ώρες εντός στόχου."}</p>
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
