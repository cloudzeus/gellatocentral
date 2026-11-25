import { Files } from "@/components/files";
import Image from "next/image";
import { StatusBadge } from "@/components/status-badge";
import { btn, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { look } from "@/lib/status";
import { platformSettings } from "@/lib/mail/send";
import { BACKUP_CHECK_DAYS, daysSince, DR_SCENARIOS, RESTORE_DRILL_DAYS } from "@/lib/ops";
import { recordContinuityCheck } from "../actions";
import { Submit } from "@/components/submit";

export default async function ContinuityPage() {
  await requirePlatform("settings.read");
  const s = await platformSettings();
  const checks = [
    { key: "backup" as const, title: "Έλεγχος αντιγράφων ασφαλείας", at: s.lastBackupCheckAt, every: BACKUP_CHECK_DAYS, how: "Άνοιξε τον χώρο αντιγράφων και επιβεβαίωσε ότι υπάρχει αντίγραφο των τελευταίων 24 ωρών και ότι το μέγεθός του είναι λογικό.", action: "Τα έλεγξα σήμερα" },
    { key: "drill" as const, title: "Δοκιμή επαναφοράς", at: s.lastRestoreDrillAt, every: RESTORE_DRILL_DAYS, how: "Στήσε τη βάση από αντίγραφο σε ξεχωριστό server, άνοιξε την εφαρμογή πάνω της και επιβεβαίωσε ότι φαίνονται οι χθεσινές αποδείξεις. Μέτρησε πόση ώρα πήρε.", action: "Έγινε δοκιμή σήμερα" },
  ];

  return (
    <Page section="Υποδομή & ασφάλεια" title="Συνέχεια λειτουργίας" description="Τι γίνεται όταν κάτι χαλάσει, και πότε επιβεβαιώθηκε τελευταία φορά ότι το σχέδιο δουλεύει">
      <div className="max-w-7xl space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {checks.map((c) => {
            const days = daysSince(c.at);
            const late = days === null || days > c.every;
            return (
              <Card key={c.key} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg">{c.title}</h2>
                  <StatusBadge look={look(late ? "danger" : "success", days === null ? "Δεν έχει γίνει ποτέ" : days === 0 ? "Σήμερα" : `Πριν από ${days} ${days === 1 ? "ημέρα" : "ημέρες"}`)} />
                </div>
                <p className="text-sm text-muted-foreground">{c.how}</p>
                <p className={`text-sm font-semibold ${late ? "text-destructive" : "text-muted-foreground"}`}>{late ? `Χρειάζεται τώρα: πρέπει να γίνεται κάθε ${c.every} ημέρες.` : `Επόμενος σε ${c.every - days!} ημέρες.`}</p>
                <form action={recordContinuityCheck.bind(null, c.key)} className="mt-auto"><Submit className={btn(late ? "default" : "outline")}>{c.action}</Submit></form>
              </Card>
            );
          })}
        </div>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Αντίγραφα ασφαλείας στο Bunny</h2>
            <p className="text-sm text-muted-foreground">Τα ανεβάζει το script του server (npm run backup) στον φάκελο platform/backup/. Από εδώ κατεβαίνουν για δοκιμή επαναφοράς.</p>
          </div>
          <div className="p-5"><Files orgId={null} category="backup" readOnly empty="Δεν έχει ανέβει ακόμα αντίγραφο ασφαλείας" /></div>
        </Card>

        <Card>
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-lg">Σενάρια και στόχοι</h2>
            <p className="text-sm text-muted-foreground">RPO: πόσα δεδομένα μπορεί να χαθούν. RTO: σε πόση ώρα ξαναδουλεύει. Είναι στόχοι σχεδιασμού· ισχύουν όταν στηθούν το αντίγραφο σε αναμονή και η συνεχής αρχειοθέτηση, και επιβεβαιώνονται με τη δοκιμή επαναφοράς.</p>
          </div>
          <Image src="/docs/dr_bc.png" alt="Πίνακας σεναρίων: τι συμβαίνει, τι κάνει το σύστημα, πόσα δεδομένα χάνονται και σε πόση ώρα επανέρχεται" width={2400} height={1140} unoptimized className="h-auto w-full border-b border-border/70 max-md:hidden" />
          <ul className="divide-y divide-border/70 md:hidden">
            {DR_SCENARIOS.map((d) => (
              <li key={d.event} className="space-y-1 px-5 py-3">
                <p className="font-semibold">{d.event}</p>
                <p className="text-sm text-muted-foreground">{d.response}</p>
                <p className="text-sm"><b>Χάνονται:</b> {d.rpo} · <b>Επαναφορά:</b> {d.rto}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg">Αν πέσει η εφαρμογή, τι κάνει ένα κατάστημα</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            <li>Συνεχίζει να πουλά από το ταμείο Android: το Viva Terminal δέχεται πληρωμές και εκτός σύνδεσης.</li>
            <li>Αν δεν δουλεύει ούτε το τερματικό, εκδίδει χειρόγραφες αποδείξεις από το θεωρημένο μπλοκ και τις περνά όταν επανέλθει το σύστημα.</li>
            <li>Τα ψυγεία συνεχίζουν να μετρούν: οι μετρήσεις στέλνονται όλες μαζί μόλις επανέλθει η σύνδεση.</li>
            <li>Ενημερώνει την υποστήριξη· η κατάσταση του συστήματος φαίνεται στη σελίδα «Υποδομή».</li>
          </ol>
        </Card>
      </div>
    </Page>
  );
}
