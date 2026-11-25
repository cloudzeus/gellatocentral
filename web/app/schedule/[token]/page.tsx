import Link from "next/link";
import { Check } from "lucide-react";
import { Submit } from "@/components/submit";
import { btn, Card } from "@/components/ui";
import { publicSchedule } from "@/lib/staff-db";
import { acknowledge } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { look } from "@/lib/status";
import { ExpiredLink } from "@/components/state-screen";

// Το περιεχόμενο εξαρτάται πάντα από το προσωπικό token και από τρέχοντα δεδομένα.
export const instant = false;

const dateTime = (value: Date | string) => new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default async function SchedulePage({ params, searchParams }: PageProps<"/schedule/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  let schedule;
  try { schedule = await publicSchedule(token); } catch { return <ExpiredLink title="Ο σύνδεσμος του προγράμματος δεν ισχύει πια" />; }
  return <main className="mx-auto max-w-3xl p-4 py-8 sm:p-6"><header className="mb-6"><p className="text-sm text-muted-foreground">{schedule.orgName}</p><h1 className="text-2xl font-semibold">Πρόγραμμα · {schedule.employee.name}</h1><p className="mt-1 text-sm text-muted-foreground">Βλέπεις μόνο τις δικές σου δημοσιευμένες βάρδιες.</p></header>{query.saved ? <p role="status" className="mb-4 rounded-lg bg-success/10 p-3 text-sm text-success-ink">Η ανάγνωση καταχωρήθηκε.</p> : null}{typeof query.error === "string" ? <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}<div className="grid gap-4">{schedule.publications.map((publication) => <Card key={publication.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Έκδοση {publication.version}</h2><p className="text-sm text-muted-foreground">{dateTime(publication.fromAt)} → {dateTime(publication.toAt)}</p></div>{schedule.acknowledgedVersion >= publication.version ? <StatusBadge look={look("success", "Το είδα")} /> : <form action={acknowledge}><input type="hidden" name="token" value={token} /><input type="hidden" name="version" value={publication.version} /><Submit className={btn("outline", "sm")}><Check /> Το είδα</Submit></form>}</div><div className="mt-3 grid gap-2">{publication.shifts.map((shift) => <div key={shift.id} className="rounded-lg border border-border/60 p-3 text-sm"><strong>{dateTime(shift.startsAt)} → {dateTime(shift.endsAt)}</strong><p className="text-xs text-muted-foreground">{shift.storeName ?? "—"} · {shift.departmentName ?? "—"} · διάλειμμα {shift.breakMinutes} λεπτά</p>{shift.note ? <p className="mt-1 text-xs">{shift.note}</p> : null}</div>)}</div></Card>)}{!schedule.publications.length ? <Card className="p-6 text-sm text-muted-foreground">Δεν έχει δημοσιευθεί βάρδια για σένα.</Card> : null}</div>{schedule.publications.length ? <Link href={`/schedule/${token}/ics`} className={`${btn("outline", "sm")} mt-5`}>Λήψη ημερολογίου ICS</Link> : null}</main>;
}
