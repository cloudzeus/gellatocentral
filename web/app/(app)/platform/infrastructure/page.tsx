import { settings } from "@/lib/config";
import Image from "next/image";
import { Checklist } from "@/components/checklist";
import { Badge, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailConfigured } from "@/lib/mail/send";
import { SCALE_READY, SCALING_STAGES } from "@/lib/ops";
import { checkoutConfigured } from "@/lib/viva/checkout";
import { vivaConfigured } from "@/lib/viva/cloud-terminal";

const count = new Intl.NumberFormat("el-GR");

/** Μετρά πόσο κάνει η βάση να απαντήσει και μαζεύει τα μεγέθη του συστήματος. */
async function snapshot() {
  const started = performance.now();
  const [[{ size }], orgs, devices, readings, sales] = await Promise.all([
    db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
    db.organization.count(),
    db.device.count({ where: { active: true } }),
    db.reading.count(),
    db.sale.count({ where: { status: "COMPLETED" } }),
  ]);
  return { ms: Math.round(performance.now() - started), size, orgs, devices, readings, sales };
}

export default async function InfrastructurePage() {
  await requirePlatform("settings.read");
  const { ms, size, orgs, devices, readings, sales } = await snapshot();
  const mb = Number(size) / 1024 / 1024;
  const tiles = [
    { label: "Απόκριση βάσης", value: `${ms} ms`, hint: ms < 200 ? "Γρήγορη" : "Αργή: ώρα για το επόμενο στάδιο", ok: ms < 200 },
    { label: "Μέγεθος βάσης", value: mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`, hint: `${count.format(sales)} αποδείξεις · ${count.format(readings)} μετρήσεις`, ok: true },
    { label: "Φορτίο", value: `${count.format(orgs)} επιχειρήσεις`, hint: `${count.format(devices)} ενεργές συσκευές`, ok: true },
  ];
  const [isvReady, checkoutReady, mailReady, conf] = await Promise.all([vivaConfigured(), checkoutConfigured(), mailConfigured(), settings("CRON_SECRET", "VIVA_ENV", "BUNNY_STORAGE_ZONE", "BUNNY_STORAGE_KEY")]);
  const config = [
    { label: "Viva ISV (πληρωμές και τιμολόγηση πελατών)", done: isvReady },
    { label: "Viva πλατφόρμας (είσπραξη συνδρομών)", done: checkoutReady },
    { label: "Mailgun (email)", done: mailReady },
    { label: "Bunny (αποθήκευση αρχείων)", done: !!(conf.BUNNY_STORAGE_ZONE && conf.BUNNY_STORAGE_KEY) },
    { label: "Μυστικό για τις προγραμματισμένες εργασίες", done: conf.CRON_SECRET.length >= 20 },
    { label: "Έλεγχος διεύθυνσης Tailscale των συσκευών (TRUST_PROXY στο .env του server)", done: process.env.TRUST_PROXY === "1" },
    { label: "Περιβάλλον παραγωγής της Viva", done: conf.VIVA_ENV === "production" },
  ];


  return (
    <Page section="Υποδομή & ασφάλεια" title="Υποδομή" description="Η κατάσταση του συστήματος τώρα και πώς μεγαλώνει χωρίς να ξαναχτιστεί">
      <div className="max-w-7xl space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.label} className="p-5">
              <p className="text-sm font-medium text-muted-foreground">{t.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{t.value}</p>
              <p className={`mt-1 text-sm ${t.ok ? "text-muted-foreground" : "font-semibold text-destructive"}`}>{t.hint}</p>
            </Card>
          ))}
        </div>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Συνδέσεις αυτού του server</h2><p className="text-sm text-muted-foreground">Ορίζονται στις Ρυθμίσεις & email. Ό,τι λείπει δεν σταματά την εφαρμογή, απλώς η αντίστοιχη λειτουργία μένει ανενεργή.</p></div>
          <ul className="divide-y divide-border/70">
            {config.map((c) => <li key={c.label} className="flex items-center gap-3 px-5 py-3"><span className="min-w-0 flex-1 font-medium">{c.label}</span><Badge tone={c.done ? "success" : "warning"}>{c.done ? "Ενεργό" : "Δεν έχει οριστεί"}</Badge></li>)}
          </ul>
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Πώς μεγαλώνει</h2><p className="text-sm text-muted-foreground">Κάθε στάδιο προσθέτει μηχανήματα στα ήδη υπάρχοντα. Τίποτα δεν πετιέται και τίποτα δεν αγοράζεται πριν χρειαστεί.</p></div>
          <Image src="/docs/infra_scale.png" alt="Διάγραμμα υποδομής: χρήστες και συσκευές, είσοδος με load balancer, κόμβοι εφαρμογής χωρίς κατάσταση, βάση με αντίγραφο σε αναμονή και αντίγραφα ασφαλείας, εξωτερικές υπηρεσίες" width={2400} height={1515} unoptimized className="h-auto w-full border-b border-border/70" />
          <ol className="divide-y divide-border/70">
            {SCALING_STAGES.map((s) => (
              <li key={s.stage} className="grid gap-x-6 gap-y-1 px-5 py-3 md:grid-cols-[11rem_1fr_10rem]">
                <p className="font-semibold">{s.stage}</p>
                <div><p>{s.what}</p><p className="text-sm text-muted-foreground">Πότε: {s.when}</p></div>
                <p className="text-sm font-medium text-muted-foreground md:text-right">{s.add === "—" ? "" : `+ ${s.add}`}</p>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">Τι είναι ήδη έτοιμο για πολλούς κόμβους</h2></div>
          <Checklist items={SCALE_READY} />
        </Card>
      </div>
    </Page>
  );
}
