import { Checklist } from "@/components/checklist";
import { Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { db } from "@/lib/db";
import { SECURITY_CONTROLS } from "@/lib/ops";

export default async function SecurityPage() {
  await requirePlatform("settings.manage");
  const now = new Date();
  const [sessions, locked, pending, staff, unpaired, paired, bound] = await Promise.all([
    db.session.count({ where: { expiresAt: { gt: now } } }),
    db.user.count({ where: { lockedUntil: { gt: now } } }),
    db.user.count({ where: { passwordHash: null } }),
    db.user.count({ where: { platformRole: { not: null } } }),
    db.device.count({ where: { active: true, kind: { not: "POS_WEB" }, apiTokenHash: null } }),
    db.device.count({ where: { active: true, apiTokenHash: { not: null } } }),
    db.device.count({ where: { active: true, apiTokenHash: { not: null }, tailscaleIp: { not: null } } }),
  ]);
  const tiles = [
    { label: "Ανοιχτές συνεδρίες", value: sessions, hint: "χρήστες συνδεδεμένοι αυτή τη στιγμή", bad: false },
    { label: "Κλειδωμένοι λογαριασμοί", value: locked, hint: locked ? "5 λάθος κωδικοί· ξεκλειδώνουν σε 15 λεπτά" : "κανείς δεν δοκιμάζει κωδικούς", bad: locked > 0 },
    { label: "Προσκλήσεις σε εκκρεμότητα", value: pending, hint: "χρήστες που δεν έχουν ορίσει κωδικό", bad: false },
    { label: "Προσωπικό πλατφόρμας", value: staff, hint: "λογαριασμοί με πρόσβαση στην κονσόλα", bad: false },
    { label: "Συζευγμένες συσκευές", value: paired, hint: `${bound} δεμένες σε διεύθυνση Tailscale`, bad: false },
    { label: "Συσκευές χωρίς σύζευξη", value: unpaired, hint: unpaired ? "δεν μπορούν να στείλουν δεδομένα" : "όλες έχουν πιστοποιηθεί", bad: false },
  ];
  const areas = [...new Set(SECURITY_CONTROLS.map((c) => c.area))];
  const done = SECURITY_CONTROLS.filter((c) => c.done).length;

  return (
    <Page section="Υποδομή & ασφάλεια" title="Ασφάλεια" description="Τι προστατεύει την πλατφόρμα σήμερα και τι είναι στο σχέδιο">
      <div className="max-w-7xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <Card key={t.label} className="p-5">
              <p className="text-sm font-medium text-muted-foreground">{t.label}</p>
              <p className={`mt-2 text-3xl font-semibold tabular-nums ${t.bad ? "text-destructive" : ""}`}>{t.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t.hint}</p>
            </Card>
          ))}
        </div>

        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">Μέτρα ασφάλειας</h2>
            <p className="text-sm font-semibold tabular-nums text-muted-foreground">{done} από {SECURITY_CONTROLS.length} υπάρχουν</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={SECURITY_CONTROLS.length} aria-valuenow={done}>
            <div className="h-full rounded-full bg-success" style={{ width: `${(done / SECURITY_CONTROLS.length) * 100}%` }} />
          </div>
        </Card>

        {areas.map((a) => (
          <Card key={a}>
            <div className="border-b border-border/70 px-5 py-4"><h2 className="text-lg">{a}</h2></div>
            <Checklist items={SECURITY_CONTROLS.filter((c) => c.area === a)} />
          </Card>
        ))}
      </div>
    </Page>
  );
}
