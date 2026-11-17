import { MonitorUp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, Card, Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";
import { settings } from "@/lib/config";
import { db } from "@/lib/db";
import { remoteLink, showRemoteId } from "@/lib/remote";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });

// Μετά την καταγραφή: από εδώ ο τεχνικός ανοίγει το RustDesk του για τη συγκεκριμένη συσκευή.
export default async function RemotePage({ params }: PageProps<"/platform/remote/[id]">) {
  await requirePlatform("support.remote");
  const access = await db.remoteAccess.findUnique({ where: { id: (await params).id }, include: { device: { include: { store: { include: { org: true } } } } } });
  if (!access || !access.device.remoteId) notFound();
  const { device } = access;
  const c = await settings("RUSTDESK_SERVER", "RUSTDESK_KEY", "RUSTDESK_LINK");
  const steps = [
    "Πάτα «Άνοιγμα στο RustDesk». Αν ο browser ρωτήσει, επίτρεψε να ανοίξει το πρόγραμμα",
    "Ο υπάλληλος στο κατάστημα βλέπει το αίτημα στη συσκευή και πατά «Αποδοχή»",
    "Όταν τελειώσεις, κλείσε το παράθυρο του RustDesk. Η συσκευή δείχνει ότι η σύνδεση έκλεισε",
  ];
  return (
    <Page section={`Πλατφόρμα › ${device.store.org.name}`} title={`Απομακρυσμένη σύνδεση: ${device.name}`} description={`${device.store.name} · καταγράφηκε ${when.format(access.at)} από ${access.startedByName}`}
      actions={<Link href={`/platform/${device.store.orgId}#devices`} className={btn("outline")}>Πίσω στον συνδρομητή</Link>}>
      <div className="max-w-3xl space-y-4">
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">Αριθμός RustDesk της συσκευής</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-wide tabular-nums select-all">{showRemoteId(device.remoteId!)}</p>
          <a href={remoteLink(c.RUSTDESK_LINK, device.remoteId!)} className={btn("default", "lg", "mt-4")}><MonitorUp /> Άνοιγμα στο RustDesk</a>
          <p className="mt-3 text-sm text-muted-foreground">Αν δεν ανοίξει τίποτα, άνοιξε το RustDesk και πληκτρολόγησε τον αριθμό. Λόγος σύνδεσης: {access.reason}</p>
        </Card>
        <Card>
          <h2 className="border-b border-border px-5 py-4 text-lg">Τα βήματα</h2>
          <ol className="divide-y divide-border">
            {steps.map((s, i) => <li key={s} className="flex gap-3 px-5 py-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold tabular-nums">{i + 1}</span><span>{s}</span></li>)}
          </ol>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg">Ρύθμιση του RustDesk σου</h2>
          {c.RUSTDESK_SERVER ? (
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">ID server</dt><dd className="font-mono font-semibold break-all select-all">{c.RUSTDESK_SERVER}</dd></div>
              <div className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">Key</dt><dd className="font-mono font-semibold break-all select-all">{c.RUSTDESK_KEY || "—"}</dd></div>
              <p className="text-sm text-muted-foreground sm:col-span-2">Στο RustDesk: Ρυθμίσεις › Δίκτυο › ID/Relay server. Τα ίδια στοιχεία πρέπει να έχει και η συσκευή του πελάτη, αλλιώς δεν βρίσκονται μεταξύ τους</p>
            </dl>
          ) : <p className="mt-2 text-muted-foreground">Δεν έχει οριστεί δικός μας server RustDesk (Ρυθμίσεις & email › RustDesk). Μέχρι τότε η σύνδεση περνά από τον δημόσιο server του RustDesk</p>}
        </Card>
      </div>
    </Page>
  );
}
