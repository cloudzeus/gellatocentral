"use client";

// Τραπέζια στο ταμείο του browser: κάτοψη και λογαριασμός, ίδια ροή με το tablet Android (mobile/App.tsx Tables,
// mobile/WaiterScreens.tsx TableBill/PayBody). Η πληρωμή γυρίζει στο Till, που έχει ήδη ρέστα, τερματικό και αναμονή.
import { ArrowLeft, Banknote, Check, Clock, CreditCard, Flame, LoaderCircle, Plus, ReceiptText, Repeat2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { closeEmpty, fire, loadBill, loadFloor, openTable, served, unask, voidBillLine } from "./bill-actions";
import { euro, focus, ghost, grad, PALETTE, primary } from "./till-ui";

export type FloorData = Awaited<ReturnType<typeof loadFloor>>;
export type BillData = NonNullable<Awaited<ReturnType<typeof loadBill>>>;
export type BillLine = BillData["lines"][number];
export type Method = { id: string; name: string; cash: boolean };
/** Τι πληρώνεται: όλο ή είδη (απόδειξη) ή μερίδιο κατά ποσό (share). */
export type BillPay = { billId: string; amountCents: number; share?: boolean; lines?: { lineId: string; quantity: number }[] };

const OPEN_TONE = PALETTE[4];
const QUIET_MIN = 20;
const STAGE_TEXT: Record<string, string> = { empty: "Άνοιξε· τίποτα ακόμα", ordered: "Παρήγγειλαν", eating: "Τρώνε", asked: "Λογαριασμός" };
const minutesSince = (d: Date | string | null | undefined, now: Date) => (d ? Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 60000)) : 0);
const durText = (m: number) => (m < 60 ? `${m}′` : m < 1440 ? `${Math.floor(m / 60)} ώ ${String(m % 60).padStart(2, "0")}′` : `${Math.floor(m / 1440)} ${m < 2880 ? "μέρα" : "μέρες"}`);
const time = (d: Date | string) => new Date(d).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
const optsText = (o: unknown) => {
  const n = new Map<string, number>();
  for (const x of (Array.isArray(o) ? o : []) as { name: string }[]) n.set(x.name, (n.get(x.name) ?? 0) + 1);
  return [...n].map(([k, c]) => (c > 1 ? `${c}× ${k}` : k)).join(", ");
};
const failText = (e: unknown) => (e instanceof Error && e.message && !e.message.includes("Server") ? e.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά");

/** Θέσεις για την παραγγελία: όσα άτομα, αλλιώς οι θέσεις του τραπεζιού, και όσες έχουν ήδη γραμμές. */
export const seatsOf = (bill: Pick<BillData, "guests" | "lines" | "table">) => Math.max(0, ...bill.lines.map((l) => l.seat ?? 0), bill.guests ?? bill.table?.seats ?? 0);
const seatDue = (lines: BillLine[]) => {
  const m = new Map<number, number>();
  for (const l of lines) if (l.remaining > 0) m.set(l.seat ?? 0, (m.get(l.seat ?? 0) ?? 0) + l.remaining * l.unitPriceCents);
  return m;
};
export const billTitle = (b: Pick<BillData, "table" | "label">) => (b.table ? `Τραπέζι ${b.table.name}` : b.label ?? "Λογαριασμός");

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(i); }, []);
  return now;
}

const Seat = ({ n }: { n?: number | null }) => (n ? <span className="grid h-6 min-w-6 place-items-center rounded-md bg-secondary px-1 text-xs font-bold text-muted-foreground tabular-nums" aria-label={`θέση ${n}`}>{n}</span> : null);
const Chip = ({ label, sub, on, onClick }: { label: string; sub?: string; on: boolean; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-pressed={on} className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-base font-semibold transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary", focus)}>
    {label}{sub ? <span className={cn("text-sm font-medium tabular-nums", on ? "opacity-70" : "text-muted-foreground")}>{sub}</span> : null}
  </button>
);

/** Κάτοψη: ζώνες με τραπέζια· ανοιχτό = χρώμα με ό,τι χρωστάει, ελεύθερο = διακεκομμένο, πάτημα ανοίγει λογαριασμό. */
// τελευταία κατάσταση στη μνήμη: η εναλλαγή Πώληση/Τραπέζια δείχνει αμέσως την κάτοψη και ανανεώνει από πίσω
let lastFloor: FloorData | undefined;
const lastBill = new Map<string, BillData | null>();

export function Floor({ selected, reload, onOpen }: { selected?: string; reload: number; onOpen: (billId: string) => void }) {
  const now = useNow();
  const [data, setData] = useState<FloorData | undefined>(lastFloor);
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState<string>();
  const load = useCallback(() => loadFloor().then((d) => { lastFloor = d; setData(d); setError(undefined); }, (e) => setError(failText(e))), []);
  // σερβιτόροι και άλλα ταμεία αλλάζουν την κάτοψη: ανανέωση κάθε 15''
  useEffect(() => { void load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load, reload]);

  const open = async (tableId: string) => {
    setOpening(tableId);
    try {
      const r = await openTable(tableId);
      if ("error" in r) setError(r.error); else { onOpen(r.id); void load(); }
    } catch (e) { setError(failText(e)); } finally { setOpening(undefined); }
  };

  if (!data) return (
    <div className="grid min-h-60 place-items-center gap-3 text-muted-foreground">
      {error ? <><p className="text-base font-medium text-destructive">{error}</p><button type="button" onClick={load} className={ghost}>Δοκίμασε ξανά</button></> : <LoaderCircle className="size-6 animate-spin" aria-label="Φόρτωση" />}
    </div>
  );

  const byTable = new Map(data.bills.filter((b) => b.tableId).map((b) => [b.tableId!, b]));
  const loose = data.bills.filter((b) => !b.tableId);
  const zones = [...new Set(data.tables.map((x) => x.zone ?? "Χωρίς ζώνη"))];
  const due = data.bills.reduce((s, b) => s + b.dueCents - b.heldCents, 0);

  const tile = (key: string, name: string, b: FloorData["bills"][number] | undefined, onClick: () => void) => {
    const quiet = b && b.stage !== "empty" && minutesSince(b.lastAt, now) >= QUIET_MIN;
    return (
      <li key={key}>
        <button type="button" onClick={onClick} disabled={!!opening}
          aria-label={b ? `${name}, ανοιχτό, χρωστάει ${euro(b.dueCents - b.heldCents)}` : `${name}, ελεύθερο, πάτα για νέο λογαριασμό`}
          style={b ? { backgroundImage: grad(OPEN_TONE), color: OPEN_TONE.ink } : undefined}
          className={cn("flex h-33 w-full flex-col rounded-2xl p-3 text-left transition-[transform,opacity] active:scale-[0.98] disabled:opacity-60", focus,
            b ? (b.id === selected ? "ring-3 ring-foreground ring-offset-2 ring-offset-background" : b.stage === "asked" ? "ring-3 ring-warning" : "") : "border border-dashed border-border text-muted-foreground hover:bg-secondary")}>
          <span className={cn("truncate text-2xl font-bold", !b && "text-foreground/50")}>{name}</span>
          {b ? (
            <>
              <span className="truncate text-sm font-semibold">{b.readyIds.length ? "Έτοιμο στην κουζίνα" : STAGE_TEXT[b.stage]}{b.heldItems ? ` · ${b.heldItems} «Μετά»` : ""}</span>
              <span className="flex items-center gap-1 text-sm font-medium opacity-70 tabular-nums"><Clock className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{[b.openedByName, quiet ? `${durText(minutesSince(b.lastAt, now))} χωρίς κίνηση` : durText(minutesSince(b.openedAt, now))].filter(Boolean).join(" · ")}</span></span>
              <span className="mt-auto flex items-end justify-between gap-2">
                <span className="text-xl font-bold tabular-nums">{euro(b.dueCents - b.heldCents)}</span>
                {b.pendingCents ? <span className="text-xs font-semibold opacity-70">πληρώνεται</span> : null}
              </span>
            </>
          ) : <span className="mt-auto text-sm font-medium">{opening === key ? "Ανοίγει" : "Ελεύθερο"}</span>}
        </button>
      </li>
    );
  };
  const grid = "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

  return (
    <section aria-label="Τραπέζια" className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Τραπέζια</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{data.bills.length} ανοιχτά · {euro(due)}</span>
        <span className="flex flex-1 justify-end gap-4 text-sm text-muted-foreground max-sm:hidden">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded" style={{ backgroundImage: grad(OPEN_TONE) }} />Ανοιχτό· πάτα για τον λογαριασμό</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded border border-dashed border-muted-foreground" />Ελεύθερο· πάτα για νέο</span>
        </span>
      </div>
      {error ? <p role="alert" className="text-base font-medium text-destructive">{error}</p> : null}
      {data.tables.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-base text-muted-foreground">Το κατάστημα δεν έχει τραπέζια. Πρόσθεσέ τα στα Τραπέζια του καταστήματος</p> : null}
      {zones.map((z) => (
        <div key={z} className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
          <h3 className="text-sm font-semibold text-muted-foreground">{z}</h3>
          <ul className={grid}>
            {data.tables.filter((x) => (x.zone ?? "Χωρίς ζώνη") === z).map((x) => { const b = byTable.get(x.id); return tile(x.id, x.name, b, () => (b ? onOpen(b.id) : void open(x.id))); })}
          </ul>
        </div>
      ))}
      {loose.length ? (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Χωρίς τραπέζι</h3>
          <ul className={grid}>{loose.map((b) => tile(b.id, b.label ?? "Λογαριασμός", b, () => onOpen(b.id)))}</ul>
        </div>
      ) : null}
    </section>
  );
}

type PayHow = "seat" | "all" | "equal" | "items";

/** Ο λογαριασμός: γύροι, «Μετά», σερβίρισμα/ξανά/ακύρωση ανά γραμμή, θέσεις, και η είσπραξη (όλο, θέση, ίσα, είδος). */
export function BillPanel({ id, reload, busy, methods, method, setMethodId, onClose, onAdd, onAgain, onPay }: {
  id: string; reload: number; busy: boolean; methods: Method[]; method?: Method; setMethodId: (id: string) => void;
  onClose: () => void; onAdd: (b: BillData) => void; onAgain: (b: BillData, lines: BillLine[]) => void; onPay: (p: BillPay, m: Method) => void;
}) {
  const now = useNow();
  const [bill, setBill] = useState<BillData | null | undefined>(() => lastBill.get(id));
  const [error, setError] = useState<string>();
  const [seat, setSeat] = useState(0); // 0 = όλοι
  const [picked, setPicked] = useState<string>();
  const [paying, setPaying] = useState(false);
  const [working, setWorking] = useState(false);
  const load = useCallback(() => loadBill(id).then((b) => { lastBill.set(id, b); setBill(b); setError(undefined); }, (e) => setError(failText(e))), [id]);
  useEffect(() => { void load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load, reload]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- άλλος λογαριασμός: από την αρχή
  useEffect(() => { setBill(lastBill.get(id)); setSeat(0); setPicked(undefined); setPaying(false); }, [id]);

  const act = async (f: () => Promise<{ error: string } | unknown>, after?: () => void) => {
    setWorking(true);
    try {
      const r = await f();
      if (r && typeof r === "object" && "error" in r) setError(String(r.error));
      else { setPicked(undefined); if (after) after(); else await load(); }
    } catch (e) { setError(failText(e)); } finally { setWorking(false); }
  };

  const shell = (body: React.ReactNode) => <div className="flex min-h-0 flex-1 flex-col">{body}</div>;
  if (bill === undefined) return shell(<div className="grid flex-1 place-items-center py-10">{error ? <p className="text-base text-destructive">{error}</p> : <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="Φόρτωση" />}</div>);
  if (bill === null) return shell(<div className="space-y-3 py-6"><p className="text-base text-muted-foreground">Ο λογαριασμός δεν βρέθηκε</p><button type="button" onClick={onClose} className={ghost}>Στα τραπέζια</button></div>);

  const title = billTitle(bill);
  const open = bill.status === "OPEN";
  const seats = seatsOf(bill);
  const heldRound = new Map(bill.rounds.map((r) => [r.id, r.held]));
  const due = seatDue(bill.lines);
  const left = bill.dueCents - bill.heldCents;
  const shown = bill.lines.filter((l) => !seat || l.seat === seat);
  const held = bill.rounds.filter((r) => r.held && bill.lines.some((l) => l.roundId === r.id && !l.voidedAt));
  const empty = bill.totalCents === 0 && bill.paidCents === 0 && !held.length;
  const lastRound = [...bill.rounds].reverse().find((r) => !r.held && bill.lines.some((l) => l.roundId === r.id && !l.voidedAt));
  const unserved = bill.lines.filter((l) => !l.servedAt && !l.voidedAt && !heldRound.get(l.roundId));
  const seatLeft = seat ? due.get(seat) ?? 0 : left;
  const pendingShare = bill.shares.some((x) => x.status === "PENDING");

  const header = (
    <div className="flex items-center gap-2 border-b border-border pb-3">
      <button type="button" onClick={paying ? () => setPaying(false) : onClose} aria-label={paying ? "Πίσω στο τραπέζι" : "Κλείσιμο λογαριασμού"}
        className={cn("grid size-11 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-secondary", focus)}>{paying ? <ArrowLeft className="size-4.5" /> : <X className="size-4.5" />}</button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{paying ? `Είσπραξη · ${title}` : title}</h2>
        <p className="truncate text-sm text-muted-foreground tabular-nums">{[bill.guests ? `${bill.guests} άτομα` : null, durText(minutesSince(bill.openedAt, now)), bill.openedByName].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );

  if (paying && open) return shell(<>{header}<PayBody bill={bill} startSeat={seat || undefined} methods={methods} method={method} setMethodId={setMethodId} busy={busy || working || pendingShare} onPay={onPay} /></>);

  return shell(
    <>
      {header}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
        {seats > 1 ? (
          <div className="scrollbar-hide flex gap-1.5 overflow-x-auto" role="group" aria-label="Θέσεις">
            <Chip label="Όλοι" sub={left ? euro(left) : undefined} on={!seat} onClick={() => setSeat(0)} />
            {Array.from({ length: seats }, (_, i) => i + 1).map((n) => <Chip key={n} label={String(n)} sub={due.get(n) ? euro(due.get(n)!) : undefined} on={seat === n} onClick={() => setSeat(n)} />)}
          </div>
        ) : null}
        {bill.billAskedAt ? (
          <p className="flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-2.5 text-base font-semibold">
            <ReceiptText className="size-4.5 shrink-0 text-warning" aria-hidden />
            <span className="flex-1">Ζήτησαν λογαριασμό {time(bill.billAskedAt)}{bill.billAskedCash ? " · μετρητά στο ταμείο" : ""}</span>
            {open ? <button type="button" onClick={() => void act(() => unask(bill.id))} aria-label="Αναίρεση: δεν ζήτησαν λογαριασμό" className={cn("grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary", focus)}><X className="size-4" /></button> : null}
          </p>
        ) : null}
        {held.map((r) => {
          const ls = bill.lines.filter((l) => l.roundId === r.id && !l.voidedAt);
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-xl bg-warning/15 py-2 pr-2 pl-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">Περιμένουν στο «Μετά» · {ls.reduce((n, l) => n + l.quantity, 0)}</p>
                <p className="truncate text-sm text-muted-foreground">{ls.map((l) => `${l.quantity}× ${l.name}${l.seat ? ` (θ.${l.seat})` : ""}`).join(", ")}</p>
              </div>
              {open ? <button type="button" onClick={() => void act(() => fire(bill.id, r.id))} disabled={working} className={cn("inline-flex h-11 items-center gap-1.5 rounded-xl bg-foreground px-3.5 text-base font-semibold text-background disabled:opacity-40", focus)}><Flame className="size-4" />Βγάλ&apos; το</button> : null}
            </div>
          );
        })}
        {bill.rounds.length === 0 ? <p className="py-2 text-base text-muted-foreground">Τίποτα ακόμα. Πάτα «Παραγγελία»</p> : null}
        {[...bill.rounds].reverse().filter((r) => !r.held).map((r) => {
          const ls = shown.filter((l) => l.roundId === r.id);
          if (!ls.length) return null;
          const done = ls.every((l) => l.servedAt || l.voidedAt);
          return (
            <div key={r.id}>
              <p className="mt-2 mb-1 flex justify-between text-sm text-muted-foreground tabular-nums">
                <span>Γύρος {r.number} · {time(r.sentAt)}{r.sentByName && r.sentByName !== bill.openedByName ? ` · ${r.sentByName}` : ""}</span>
                <span className={done ? "" : "text-warning"}>{done ? "σερβιρίστηκε" : "στάλθηκε"}</span>
              </p>
              <ul>
                {ls.map((l) => {
                  const st = l.voidedAt ? "void" : l.servedAt ? "served" : "sent";
                  const on = picked === l.id;
                  const o = [optsText(l.options), l.note].filter(Boolean).join(" · ");
                  return (
                    <li key={l.id} className={cn("border-t border-border", on && "rounded-xl border-transparent bg-card")}>
                      <button type="button" onClick={() => setPicked(on ? undefined : l.id)} disabled={!open || st === "void"} aria-expanded={on}
                        className={cn("flex min-h-12 w-full items-center gap-2 py-1.5 text-left", on && "px-2", focus)}>
                        <span className="w-7 text-sm text-muted-foreground tabular-nums">{l.quantity}×</span>
                        <span className={cn("min-w-0 flex-1 text-base font-semibold", st === "void" && "text-muted-foreground line-through")}>
                          {l.name}{o ? <span className="block truncate text-sm font-normal text-muted-foreground">{o}</span> : null}
                        </span>
                        <Seat n={l.seat} />
                        {st === "served" ? <Check className="size-4 text-success" aria-label="σερβιρίστηκε" /> : st === "sent" ? <Clock className="size-4 text-warning" aria-label="στάλθηκε" /> : <span className="text-xs text-muted-foreground">ακυρ.</span>}
                        <span className={cn("min-w-16 text-right text-base font-semibold tabular-nums", st === "void" && "text-muted-foreground")}>{euro(l.unitPriceCents * l.quantity)}</span>
                      </button>
                      {on ? (
                        <div className="flex flex-wrap gap-2 px-2 pb-2">
                          <button type="button" disabled={working} onClick={() => void act(() => served(bill.id, [l.id], !l.servedAt))} className={ghost}><Check className="size-4" />{l.servedAt ? "Δεν σερβιρίστηκε" : "Σερβιρίστηκε"}</button>
                          <button type="button" onClick={() => { setPicked(undefined); onAgain(bill, [l]); }} className={ghost}><Repeat2 className="size-4" />Ξανά</button>
                          {l.canVoid ? <button type="button" disabled={working} onClick={() => void act(() => voidBillLine(bill.id, l.id, "Λάθος παραγγελία"))} className={cn(ghost, "text-destructive")}><Trash2 className="size-4" />Ακύρωση</button> : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {open && lastRound ? (
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={() => onAgain(bill, bill.lines.filter((l) => l.roundId === lastRound.id && !l.voidedAt))} className={ghost}><Repeat2 className="size-4" />Ξανά ο γύρος {lastRound.number}</button>
            {unserved.length ? <button type="button" disabled={working} onClick={() => void act(() => served(bill.id, unserved.map((l) => l.id), true))} className={ghost}><Check className="size-4" />{unserved.length === 1 ? "Σερβιρίστηκε" : `Σερβιρίστηκαν όλα · ${unserved.length}`}</button> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-base font-medium text-destructive">{error}</p> : null}
        {!open ? <p className="text-base text-muted-foreground">Ο λογαριασμός {bill.status === "SETTLED" ? "εξοφλήθηκε" : "ακυρώθηκε"}{bill.closedAt ? ` ${time(bill.closedAt)}` : ""}</p> : null}
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">{!open ? "Πληρώθηκαν" : seat ? `Θέση ${seat} χρωστάει` : bill.paidCents + bill.heldCents ? `Μένουν · πληρ. ${euro(bill.paidCents + bill.heldCents)}` : "Χρωστάει"}</p>
          <p className="text-2xl font-bold tabular-nums">{euro(open ? seatLeft : bill.paidCents)}</p>
        </div>
        {open && empty ? (
          <>
            <button type="button" disabled={working} onClick={() => void act(() => closeEmpty(bill.id), onClose)} className={ghost}>Κλείσιμο</button>
            <button type="button" onClick={() => onAdd(bill)} className={cn(primary, "h-12 px-5 text-base")}><Plus className="size-4.5" />Παραγγελία</button>
          </>
        ) : open ? (
          <>
            <button type="button" onClick={() => onAdd(bill)} className={left ? ghost : cn(primary, "h-12 px-5 text-base")}><Plus className="size-4.5" />Παραγγελία</button>
            {left ? <button type="button" onClick={() => setPaying(true)} disabled={!seatLeft || pendingShare} className={cn(primary, "h-12 px-5 text-base")}>{pendingShare ? "Πληρώνεται" : "Είσπραξη"}</button> : null}
          </>
        ) : <button type="button" onClick={onClose} className={cn(primary, "h-12 px-5 text-base")}>Στα τραπέζια</button>}
      </div>
    </>,
  );
}

function PayBody({ bill, startSeat, methods, method, setMethodId, busy, onPay }: {
  bill: BillData; startSeat?: number; methods: Method[]; method?: Method; setMethodId: (id: string) => void; busy: boolean; onPay: (p: BillPay, m: Method) => void;
}) {
  const due = seatDue(bill.lines);
  const bySeat = [...due.keys()].some((k) => k > 0) && due.size > 1;
  // με εισπραγμένα μερίδια μένει μόνο ποσό: οι γραμμές δεν μοιράζονται πια ανά θέση/είδος
  const [how, setHow] = useState<PayHow>(bill.heldCents ? "equal" : bySeat ? "seat" : "all");
  const [seat, setSeat] = useState<number | undefined>(startSeat && due.has(startSeat) ? startSeat : undefined);
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [people, setPeople] = useState(Math.max(2, bill.guests ?? 2));
  const left = bill.dueCents - bill.heldCents;
  const m = methods.find((x) => x.id === method?.id) ?? methods[0];
  const share = Math.ceil(left / Math.max(1, people));

  const pick = how === "seat" && seat != null ? bill.lines.filter((l) => l.remaining > 0 && (l.seat ?? 0) === seat).map((l) => ({ lineId: l.id, quantity: l.remaining }))
    : how === "items" ? bill.lines.filter((l) => items[l.id] && l.remaining > 0).map((l) => ({ lineId: l.id, quantity: l.remaining })) : undefined;
  const pickCents = pick?.reduce((s, p) => s + p.quantity * (bill.lines.find((l) => l.id === p.lineId)?.unitPriceCents ?? 0), 0) ?? 0;
  const amount = how === "all" ? left : how === "equal" ? Math.min(share, left) : pickCents;
  const go = () => {
    if (!m) return;
    if (how === "all" || (how === "equal" && share >= left)) onPay({ billId: bill.id, amountCents: left }, m);
    else if (how === "equal") onPay({ billId: bill.id, amountCents: share, share: true }, m);
    else if (pick?.length) onPay({ billId: bill.id, amountCents: pickCents, lines: pick }, m);
  };
  const hows: [PayHow, string][] = [["all", "Όλο"], ...(bySeat && !bill.heldCents ? [["seat", "Θέση"] as [PayHow, string]] : []), ["equal", "Ίσα"], ...(!bill.heldCents ? [["items", "Είδος"] as [PayHow, string]] : [])];
  const row = "flex min-h-14 w-full items-center gap-3 rounded-2xl bg-card px-3 text-left transition-colors";

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-base text-muted-foreground">Μένουν{bill.paidCents + bill.heldCents ? ` · πληρώθηκαν ${euro(bill.paidCents + bill.heldCents)}` : ""}</span>
          <span className="text-3xl font-bold tabular-nums">{euro(left)}</span>
        </div>
        <div role="radiogroup" aria-label="Τρόπος μοιράσματος" className="flex gap-1 rounded-xl bg-card p-1">
          {hows.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={how === k} onClick={() => setHow(k)}
              className={cn("h-11 flex-1 rounded-lg text-base font-semibold transition-colors", how === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary", focus)}>{label}</button>
          ))}
        </div>
        {how === "seat" ? [...due].sort((a, b) => (a[0] || 99) - (b[0] || 99)).map(([n, c]) => (
          <button key={n} type="button" role="radio" aria-checked={seat === n} onClick={() => setSeat(n)} className={cn(row, "border-2", seat === n ? "border-foreground" : "border-transparent hover:bg-secondary", focus)}>
            {n ? <Seat n={n} /> : <span className="w-6" />}
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">{n ? `Θέση ${n}` : "Κοινά (χωρίς θέση)"}</span>
              <span className="block truncate text-sm text-muted-foreground">{bill.lines.filter((l) => l.remaining > 0 && (l.seat ?? 0) === n).map((l) => `${l.remaining}× ${l.name}`).join(", ")}</span>
            </span>
            <span className="text-lg font-bold tabular-nums">{euro(c)}</span>
          </button>
        )) : null}
        {how === "items" ? bill.lines.filter((l) => l.remaining > 0).map((l) => (
          <button key={l.id} type="button" role="checkbox" aria-checked={!!items[l.id]} onClick={() => setItems((x) => ({ ...x, [l.id]: !x[l.id] }))} className={cn(row, items[l.id] ? "bg-secondary" : "hover:bg-secondary", focus)}>
            <span className={cn("grid size-6 place-items-center rounded-md border-2", items[l.id] ? "border-foreground bg-foreground text-background" : "border-muted-foreground")}>{items[l.id] ? <Check className="size-4" strokeWidth={3} /> : null}</span>
            <Seat n={l.seat} />
            <span className="min-w-0 flex-1 truncate text-base font-semibold">{l.remaining}× {l.name}</span>
            <span className="text-base font-semibold tabular-nums">{euro(l.remaining * l.unitPriceCents)}</span>
          </button>
        )) : null}
        {how === "equal" ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl bg-card p-3">
              <span className="flex-1 text-base text-muted-foreground">Σε πόσους</span>
              <button type="button" onClick={() => setPeople(Math.max(2, people - 1))} aria-label="Ένας λιγότερος" className={cn("grid size-12 place-items-center rounded-xl bg-secondary text-2xl", focus)}>−</button>
              <span className="min-w-8 text-center text-2xl font-bold tabular-nums">{people}</span>
              <button type="button" onClick={() => setPeople(Math.min(20, people + 1))} aria-label="Ένας παραπάνω" className={cn("grid size-12 place-items-center rounded-xl bg-secondary text-2xl", focus)}>+</button>
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">{euro(Math.min(share, left))} ο καθένας. Η απόδειξη βγαίνει με το τελευταίο μερίδιο</p>
          </>
        ) : null}
        {how === "seat" && due.has(0) ? <p className="text-sm text-muted-foreground">Τα κοινά πληρώνονται χωριστά ή μαζί με το «Όλο»</p> : null}
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        {methods.length > 1 ? (
          <div role="radiogroup" aria-label="Τρόπος πληρωμής" className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
            {methods.map((x) => { const on = x.id === m?.id; const I = x.cash ? Banknote : CreditCard; return (
              <button key={x.id} type="button" role="radio" aria-checked={on} onClick={() => setMethodId(x.id)}
                className={cn("flex h-12 items-center justify-center gap-2 rounded-xl border px-2 text-base font-semibold transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-secondary", focus)}>
                <I className="size-4.5" strokeWidth={1.75} aria-hidden />{x.name}
              </button>); })}
          </div>
        ) : null}
        <button type="button" onClick={go} disabled={busy || !m || amount <= 0} className={cn(primary, "w-full")}>
          <span className="flex items-center gap-2">{busy ? <LoaderCircle className="size-5 animate-spin" /> : m?.cash ? <Banknote className="size-5" /> : <CreditCard className="size-5" />}{busy ? "Περίμενε" : m?.cash ? "Μετρητά" : "Κάρτα στο τερματικό"}</span>
          <span className="tabular-nums">{euro(amount)}</span>
        </button>
      </div>
    </>
  );
}
