import Image from "next/image";
import { CalendarDays, Clock, LogOut, MapPin, Palmtree, Star } from "lucide-react";
import { logout } from "@/app/login/actions";
import { Submit } from "@/components/submit";
import { btn, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { myStaffPortal } from "@/lib/staff-db";

// Προσωπικά δεδομένα του συνδεδεμένου εργαζομένου.
export const instant = false;

const day = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" });
const time = new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
const hours = (s: { startsAt: Date; endsAt: Date; breakMinutes: number }) => Math.max(0, (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000 - s.breakMinutes / 60);

export default async function MyPortal({ searchParams }: PageProps<"/me">) {
  const user = await requireUser();
  const q = await searchParams;
  const me = await myStaffPortal(user.id);
  const now = new Date().getTime();
  const week = me?.shifts.filter((s) => s.endsAt.getTime() > now && s.startsAt.getTime() < now + 7 * 86_400_000) ?? [];
  const byDay = new Map<string, NonNullable<typeof me>["shifts"]>();
  for (const s of me?.shifts.filter((x) => x.endsAt.getTime() > now) ?? []) {
    const k = day.format(s.startsAt);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  return (
    <main className="mx-auto grid max-w-3xl gap-5 p-4 py-6 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="" width={640} height={352} className="h-9 w-auto" />
          <div><p className="text-sm text-muted-foreground">{me?.orgName ?? "Gelato System"}</p><h1 className="text-xl font-semibold">{me?.name ?? user.name}</h1></div>
        </div>
        <form action={logout}><Submit className={btn("outline", "sm")}><LogOut /> Έξοδος</Submit></form>
      </header>
      {q.welcome ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm font-medium text-success">Ο λογαριασμός σου είναι έτοιμος. Εδώ βλέπεις τις δημοσιευμένες βάρδιες σου.</p> : null}
      {!me ? <Card className="p-6 text-sm text-muted-foreground">Ο λογαριασμός σου δεν είναι συνδεδεμένος με εργαζόμενο. Ζήτα από τον υπεύθυνο νέο link εγγραφής.</Card> : <>
        <section className="grid grid-cols-2 gap-3">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Βάρδιες τις επόμενες 7 ημέρες</p><p className="mt-1 text-2xl font-semibold tabular-nums">{week.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Ώρες εργασίας (χωρίς διάλειμμα)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{week.reduce((a, s) => a + hours(s), 0).toLocaleString("el-GR", { maximumFractionDigits: 1 })}</p></Card>
        </section>
        <Card className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Ειδικότητες:</span>{me.specialties.length ? me.specialties.map((x) => <span key={x.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-sm font-medium">{x.primary ? <Star className="size-3.5 fill-current text-warning" aria-label="κύρια" /> : null}{x.name}</span>) : <span className="text-sm">—</span>}</div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Καταστήματα:</span>{me.stores.length ? me.stores.map((x) => <span key={x} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm"><MapPin className="size-3.5" />{x}</span>) : <span className="text-sm">—</span>}</div>
        </Card>
        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarDays className="size-5" /> Οι βάρδιες μου</h2>
          {[...byDay].map(([label, list]) => <Card key={label} className="p-4">
            <h3 className="mb-2 font-medium capitalize">{label}</h3>
            <div className="grid gap-2">{list.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 p-3 text-sm">
              <strong className="inline-flex items-center gap-1 tabular-nums"><Clock className="size-4" />{time.format(s.startsAt)}–{time.format(s.endsAt)}</strong>
              {s.storeName ? <span className="inline-flex items-center gap-1"><MapPin className="size-4 text-muted-foreground" />{s.storeName}</span> : null}
              {s.specialtyName ? <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{s.specialtyName}</span> : null}
              {s.breakMinutes ? <span className="text-muted-foreground">διάλειμμα {s.breakMinutes}′</span> : null}
              {s.note ? <p className="w-full text-xs text-muted-foreground">{s.note}</p> : null}
            </div>)}</div>
          </Card>)}
          {!byDay.size ? <Card className="p-6 text-sm text-muted-foreground">Δεν έχει δημοσιευθεί καμία βάρδια για σένα τις επόμενες 4 εβδομάδες.</Card> : null}
        </section>
        {me.leaves.length ? <section className="grid gap-2"><h2 className="flex items-center gap-2 text-lg font-semibold"><Palmtree className="size-5" /> Άδειες</h2>{me.leaves.map((l) => <Card key={l.id} className="p-3 text-sm">{l.fromAt.toLocaleDateString("el-GR")} → {l.toAt.toLocaleDateString("el-GR")}{"kind" in l && l.kind ? ` · ${String(l.kind)}` : ""}</Card>)}</section> : null}
      </>}
    </main>
  );
}
