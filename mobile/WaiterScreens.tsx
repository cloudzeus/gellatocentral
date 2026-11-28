// Οθόνες σερβιτόρου για το κινητό, και η στήλη τραπεζιού του tablet (ίδιο component, στενό).
// Mockup: docs/analysis/mockups/device-roles-phone-tablet.html, ενότητα 2α (Toast/Lightspeed/Square/TouchBistro):
// «Σε περιμένουν» πρώτα, στάδιο και χρόνος ανά τραπέζι, θέσεις, «Τώρα / Μετά», «Τελείωσε», λογαριασμός ανά θέση.
import { ArrowLeft, Banknote, Check, ChevronUp, Clock, CreditCard, Flame, Pause, Plus, ReceiptText, Repeat2, Search, Send, Trash2, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, useWindowDimensions, Vibration, View } from "react-native";
import { ApiError, askBill, type Bill, type BillLine, type BillPick, type BillSummary, cancelBill, type DiningTable, fireRound, getBill, getBills, markServed, openBill, type PaymentMethod, type Product, type Session, voidBillLine } from "./api";
import { getDay } from "./reservations-api";
import { isoDay, type Reservation } from "./reservations";
import { euro, type Theme, tint, ty } from "./theme";
import { durText, lineState, minutesSince, seatDue, seatPick, seatsOf, type Urgent, urgentList } from "./waiter";

const ICON = { size: 18, strokeWidth: 1.75 };
const num = { fontVariant: ["tabular-nums" as const] };
const time = (d: string) => new Date(d).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
const failText = (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά." : e.message || "Κάτι πήγε στραβά. Δοκίμασε ξανά.") : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const unpairedBy = (e: unknown) => e instanceof ApiError && e.status === 401;
const opts = (o: BillLine["options"]) => { const n = new Map<string, number>(); for (const x of o ?? []) n.set(x.name, (n.get(x.name) ?? 0) + 1); return [...n].map(([k, c]) => (c > 1 ? `${c}× ${k}` : k)).join(", "); };

function Btn({ t, label, Icon, onPress, primary, disabled, flex, danger }: { t: Theme; label: string; Icon?: typeof Plus; onPress: () => void; primary?: boolean; disabled?: boolean; flex?: number; danger?: boolean }) {
  const fg = primary ? t.onAction : danger ? t.bad : t.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={({ pressed }) => ({ flex, minHeight: 50, borderRadius: 14, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: primary ? t.action : pressed ? t.raised : t.card, opacity: disabled ? 0.4 : pressed ? 0.88 : 1 })}>
      {Icon ? <Icon {...ICON} color={fg} /> : null}<Text numberOfLines={1} style={ty(15, "s", fg)}>{label}</Text>
    </Pressable>
  );
}

const Chip = ({ t, label, on, onPress, sub }: { t: Theme; label: string; on: boolean; onPress: () => void; sub?: string }) => (
  <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} style={({ pressed }) => ({ minHeight: 40, minWidth: 44, paddingHorizontal: 12, borderRadius: 20, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: on ? t.text : pressed ? t.card : t.raised })}>
    <Text style={[ty(13.5, "s", on ? t.ink : t.text), num]}>{label}</Text>{sub ? <Text style={[ty(12, "m", on ? t.ink : t.muted), num]}>{sub}</Text> : null}
  </Pressable>
);

const Seat = ({ t, n }: { t: Theme; n?: number | null }) => (n ? <View style={{ minWidth: 22, height: 22, borderRadius: 7, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Text style={[ty(11.5, "b", t.muted), num]}>{n}</Text></View> : null);

function Loading({ t, error, retry, back }: { t: Theme; error?: string; retry: () => void; back?: () => void }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>{error ? <><Text style={ty(14, "m", t.bad)}>! {error}</Text><Btn t={t} label="Δοκίμασε ξανά" onPress={retry} />{back ? <Btn t={t} label="Πίσω" onPress={back} /> : null}</> : <ActivityIndicator color={t.muted} />}</View>;
}

// ---- Λίστα τραπεζιών (κινητό) ----
// Mockup ώρας αιχμής: docs/analysis/mockups/waiter-phone-rush.html (3 πλακίδια στη σειρά, ενέργεια πάνω στη γραμμή).

export type OpenMode = "bill" | "pay";

const URGENT_LOOK = (t: Theme): Record<Urgent["kind"], { c: string; go: string }> => ({
  ready: { c: t.ok, go: "Το πήρα" },
  asked: { c: t.bad, go: "Είσπραξη" },
  reservation: { c: t.categories[1], go: "Δες" },
  held: { c: t.wait, go: "Βγάλ' το" },
  quiet: { c: t.wait, go: "Άνοιξε" },
});

/** Γραμμή «Σε περιμένουν»: άγγιγμα στη γραμμή ανοίγει το τραπέζι, το κουμπί κάνει την κίνηση κατευθείαν. */
export function UrgentRow({ t, u, name, busy, onPress, onAct }: { t: Theme; u: Urgent; name?: string; busy?: boolean; onPress: () => void; onAct?: () => void }) {
  const look = URGENT_LOOK(t)[u.kind];
  const title = name ? u.title.replace(/^[^·]*· /, "") : u.title;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${u.title}. ${u.sub}`} style={({ pressed }) => ({ minHeight: 52, borderRadius: 12, paddingLeft: 10, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: pressed ? t.raised : t.panel, borderLeftWidth: 3, borderLeftColor: look.c })}>
      {name ? <Text numberOfLines={1} style={[ty(15, "b", t.text), num, { minWidth: 30 }]}>{name}</Text> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={ty(13.5, "s", t.text)}>{title}</Text>
        <Text numberOfLines={1} style={[ty(12, "m", t.muted), num]}>{u.sub}{u.since != null ? ` · πριν ${durText(u.since)}` : ""}</Text>
      </View>
      <Pressable onPress={onAct ?? onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={`${look.go}: ${u.title}`} hitSlop={4}
        style={({ pressed }) => ({ height: 40, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center", backgroundColor: u.kind === "quiet" || u.kind === "reservation" ? t.raised : t.action, opacity: busy ? 0.4 : pressed ? 0.85 : 1 })}>
        <Text style={ty(13, "s", u.kind === "quiet" || u.kind === "reservation" ? t.text : t.onAction)}>{busy ? "…" : look.go}</Text>
      </Pressable>
    </Pressable>
  );
}

/** Χρώμα και λέξη ανά στάδιο: το ίδιο στο πλακίδιο και στο υπόμνημα του mockup. */
const stageLook = (t: Theme, b: BillSummary) =>
  b.readyIds?.length ? { c: t.ok, text: "Έτοιμο · πάρ' το" }
  : b.billAskedAt ? { c: t.bad, text: "Λογαριασμός" }
  : b.heldItems && b.stage === "eating" ? { c: t.wait, text: `${b.heldItems} στο Μετά` }
  : b.stage === "eating" ? { c: t.ok, text: "Τρώνε" }
  : b.stage === "ordered" && b.kitchenSince ? { c: t.categories[4], text: `Στην κουζίνα · ${durText(minutesSince(b.kitchenSince, new Date()))}` }
  : b.stage === "ordered" ? { c: t.categories[4], text: "Παρήγγειλαν" }
  : { c: t.faint, text: b.heldItems ? `${b.heldItems} στο Μετά` : "Μόλις κάθισαν" };
// σειρά στο πλέγμα: ό,τι θέλει τον σερβιτόρο πρώτα
const rank = (b: BillSummary, now: Date) => (b.readyIds?.length ? -1 : b.billAskedAt ? 0 : b.heldItems && b.stage === "eating" ? 1 : b.stage !== "empty" && minutesSince(b.lastAt, now) >= 20 ? 2 : 3);

/** Σκελετός αντί για άδεια οθόνη με σπίνερ: φαίνεται αμέσως πού θα έρθει τι. */
export function Skeleton({ t, rows = 6, grid }: { t: Theme; rows?: number; grid?: boolean }) {
  return (
    <View accessibilityLabel="Φόρτωση" style={{ padding: 12, gap: 6 }}>
      <View style={{ width: 140, height: 22, borderRadius: 6, backgroundColor: t.card, marginBottom: 8 }} />
      {grid ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{Array.from({ length: rows }, (_, i) => <View key={i} style={{ width: "32%", height: 84, borderRadius: 12, backgroundColor: t.panel }} />)}</View>
        : Array.from({ length: rows }, (_, i) => <View key={i} style={{ height: 40, borderRadius: 8, backgroundColor: i % 3 ? t.panel : t.card }} />)}
    </View>
  );
}

/**
 * Κινητό του σερβιτόρου: «Σε περιμένουν» με την κίνηση πάνω στη γραμμή, μετά τα δικά μου τραπέζια σε 3 στήλες
 * (στάδιο, ποσό, λεπτά· όσα θέλουν κάτι πρώτα), και τα ελεύθερα ως μικρά κουμπιά. me: ο υπάλληλος της βάρδιας.
 */
export function WaiterTables({ t, session, now, me, onOpen, onReservations, onSoldOut, onUnpaired }: {
  t: Theme; session: Session; now: Date; me?: string; onOpen: (billId: string, mode?: OpenMode) => void; onReservations: () => void; onSoldOut?: (ids: string[]) => void; onUnpaired: () => void;
}) {
  const [data, setData] = useState<{ tables: DiningTable[]; bills: BillSummary[] }>();
  const [res, setRes] = useState<Reservation[]>([]);
  const [error, setError] = useState<string>();
  const [mine, setMine] = useState(true);
  const [opening, setOpening] = useState<string>();
  const [firing, setFiring] = useState<string>();
  const { width } = useWindowDimensions();
  const readySeen = useRef(new Set<string>());
  const load = useCallback(() => Promise.all([getBills(session), getDay(session, isoDay(new Date())).catch(() => null)]).then(([d, r]) => {
    // νέο «Έτοιμο» από την κουζίνα σε δικό μου τραπέζι: μία δόνηση
    const ready = d.bills.filter((b) => b.readyIds?.length && (!me || b.waiterId === me || !b.waiterId)).flatMap((b) => b.readyIds!);
    if (ready.some((id) => !readySeen.current.has(id))) Vibration.vibrate([0, 120, 80, 120]);
    readySeen.current = new Set(ready);
    setData(d); if (r) setRes(r.reservations); setError(undefined); if (d.soldOut) onSoldOut?.(d.soldOut);
  }, (e) => (unpairedBy(e) ? onUnpaired() : setError(failText(e)))), [session, onUnpaired, onSoldOut, me]);
  useEffect(() => { void load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  const open = async (tableId: string) => {
    setOpening(tableId);
    try { onOpen((await openBill(session, { tableId })).id); } catch (e) { if (unpairedBy(e)) onUnpaired(); else setError(failText(e)); } finally { setOpening(undefined); }
  };
  // «Βγάλ' το» από τη λίστα: όλα τα «Μετά» του τραπεζιού πάνε σε κουζίνα/bar χωρίς να ανοίξει το τραπέζι
  const fire = async (billId: string) => {
    setFiring(billId);
    try {
      const b = await getBill(session, billId);
      for (const r of b.rounds.filter((x) => x.held && b.lines.some((l) => l.roundId === x.id && !l.voidedAt))) await fireRound(session, billId, r.id);
      Vibration.vibrate(15);
      await load();
    } catch (e) { if (unpairedBy(e)) onUnpaired(); else setError(failText(e)); } finally { setFiring(undefined); }
  };

  // «Το πήρα»: τα έτοιμα της κουζίνας σημειώνονται σερβιρισμένα
  const took = async (b: BillSummary) => {
    setFiring(b.id);
    try { await markServed(session, b.id, b.readyIds ?? [], true); await load(); } catch (e) { if (unpairedBy(e)) onUnpaired(); else setError(failText(e)); } finally { setFiring(undefined); }
  };

  if (!data) return error ? <Loading t={t} error={error} retry={load} /> : <Skeleton t={t} grid rows={9} />;
  const filterMine = mine && !!me && data.bills.some((b) => b.waiterId === me);
  const bills = (filterMine ? data.bills.filter((b) => b.waiterId === me) : data.bills).slice().sort((a, b) => rank(a, now) - rank(b, now));
  const urgent = urgentList(bills, data.tables, res, now, euro);
  const byTable = new Map(data.bills.filter((b) => b.tableId).map((b) => [b.tableId!, b]));
  const free = data.tables.filter((x) => !byTable.has(x.id));
  const short = (b: BillSummary) => { const x = data.tables.find((y) => y.id === b.tableId); return x ? x.name : b.label ?? "—"; };
  const tileW = Math.floor((width - 24 - 12) / 3);
  const freeW = Math.floor((width - 24 - 30) / 6);
  const total = bills.reduce((n, b) => n + b.dueCents - b.heldCents, 0);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, gap: 6, paddingBottom: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 }}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={ty(19, "s", t.text)}>Τραπέζια</Text>
          <Text numberOfLines={1} style={[ty(12, "m", t.muted), num]}>{bills.length} {filterMine ? "δικά μου" : "ανοιχτά"}{total ? ` · ${euro(total)} ανοιχτά` : ""}</Text>
        </View>
        {me ? (
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", backgroundColor: t.card, borderRadius: 10, padding: 3 }}>
            {([[true, "Δικά μου"], [false, "Όλα"]] as const).map(([v, label]) => (
              <Pressable key={label} onPress={() => setMine(v)} accessibilityRole="radio" accessibilityState={{ checked: mine === v }} style={{ minHeight: 38, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center", backgroundColor: mine === v ? t.action : "transparent" }}>
                <Text style={ty(12.5, "s", mine === v ? t.onAction : t.muted)}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {mine && me && !filterMine && data.bills.length ? <Text style={ty(12.5, "m", t.faint)}>Δεν έχεις ανοίξει τραπέζι ακόμα· φαίνονται όλα.</Text> : null}
      {error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>! {error}</Text> : null}

      {urgent.length ? <Text style={[ty(12.5, "s", t.muted), { marginTop: 4 }]}>Σε περιμένουν · {urgent.length}</Text> : null}
      {urgent.map((u) => {
        const b = u.billId ? data.bills.find((x) => x.id === u.billId) : undefined;
        const go = () => (u.billId ? onOpen(u.billId) : onReservations());
        return <UrgentRow key={u.key} t={t} u={u} name={b ? short(b) : undefined} busy={firing === u.billId} onPress={go}
          onAct={u.kind === "ready" && b ? () => void took(b) : u.kind === "held" && u.billId ? () => void fire(u.billId!) : u.kind === "asked" && u.billId ? () => onOpen(u.billId!, "pay") : go} />;
      })}

      {bills.length ? <Text style={[ty(12.5, "s", t.muted), { marginTop: 8 }]}>{filterMine ? "Τα δικά μου" : "Ανοιχτά"} · {bills.length}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {bills.map((b) => {
          const look = stageLook(t, b);
          return (
            <Pressable key={b.id} onPress={() => onOpen(b.id)} accessibilityRole="button" accessibilityLabel={`Τραπέζι ${short(b)}, ${look.text}, χρωστάει ${euro(b.dueCents - b.heldCents)}`}
              style={({ pressed }) => ({ width: tileW, height: 84, borderRadius: 12, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 7, borderTopWidth: 3, borderTopColor: look.c, backgroundColor: b.billAskedAt ? tint(t.bad) : pressed ? t.raised : t.panel })}>
              <Text numberOfLines={1} style={[ty(20, "b", t.text), num]}>{short(b)}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: look.c }} />
                <Text numberOfLines={1} style={[ty(11.5, "m", t.muted), { flex: 1 }]}>{look.text}</Text>
              </View>
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={[ty(12.5, "s", t.text), num]}>{b.dueCents - b.heldCents ? euro(b.dueCents - b.heldCents).replace(" €", "") : "—"}</Text>
                <Text style={[ty(11.5, "m", t.faint), num]}>{durText(minutesSince(b.openedAt, now))}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {free.length ? <Text style={[ty(12.5, "s", t.muted), { marginTop: 8 }]}>Ελεύθερα · πάτα για νέο τραπέζι · {free.length}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {free.map((x) => (
          <Pressable key={x.id} onPress={() => void open(x.id)} disabled={!!opening} accessibilityRole="button" accessibilityLabel={`Τραπέζι ${x.name}, ελεύθερο${x.zone ? `, ${x.zone}` : ""}, ${x.seats} θέσεις`}
            style={({ pressed }) => ({ width: freeW, height: 44, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.divider, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.card : "transparent" })}>
            <Text numberOfLines={1} style={ty(14, "s", t.muted)}>{opening === x.id ? "…" : x.name}</Text>
          </Pressable>
        ))}
      </View>
      {data.tables.length === 0 ? <Text style={[ty(13.5, "m", t.muted), { lineHeight: 20 }]}>Το κατάστημα δεν έχει τραπέζια. Πρόσθεσέ τα από την κονσόλα.</Text> : null}
    </ScrollView>
  );
}

// ---- Τραπέζι: ανά θέση, «Μετά», σερβίρισμα, λογαριασμός ----

type Mode = "bill" | "pay";

/**
 * Ο λογαριασμός ενός τραπεζιού σε στενή στήλη (κινητό, ή δεξιά στήλη στο tablet). Πάτημα σε γραμμή: σερβιρίστηκε,
 * ξανά το ίδιο, ακύρωση. Οι αποστολές «Μετά» φαίνονται πάνω με «Βγάλ' το».
 */
export function TableBill({ t, session, id, now, cash, methods, method, setMethodId, busy, onBack, onAdd, onAgain, onPay, onShare, onUnpaired, reload = 0, compact, startMode = "bill" }: {
  t: Theme; session: Session; id: string; now: Date; cash: boolean; methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void; busy: boolean;
  onBack?: () => void; onAdd: (title: string, seats: number) => void; onAgain: (lines: BillLine[], title: string, seats: number) => void; startMode?: Mode;
  onPay: (b: Bill, title: string, pick?: { lines: BillPick[]; cents: number; items: number }) => void; onShare: (b: Bill, title: string, cents: number) => void; onUnpaired: () => void;
  reload?: number; compact?: boolean;
}) {
  const [bill, setBill] = useState<Bill>();
  const [error, setError] = useState<string>();
  const [seat, setSeat] = useState(0); // 0 = όλοι
  const [picked, setPicked] = useState<string>();
  const [mode, setMode] = useState<Mode>(startMode);
  const [working, setWorking] = useState(false);
  const fail = useCallback((e: unknown) => (unpairedBy(e) ? onUnpaired() : setError(failText(e))), [onUnpaired]);
  const load = useCallback(() => getBill(session, id).then((b) => { setBill(b); setError(undefined); }, fail), [session, id, fail]);
  useEffect(() => { void load(); const i = setInterval(load, 15_000); return () => clearInterval(i); }, [load, reload]);

  const act = async (f: () => Promise<unknown>, after?: () => void) => {
    setWorking(true);
    try { await f(); setPicked(undefined); if (after) after(); else await load(); } catch (e) { fail(e); } finally { setWorking(false); }
  };

  if (!bill) return error ? <Loading t={t} error={error} retry={load} back={onBack} /> : <Skeleton t={t} rows={8} />;
  const title = bill.table ? `Τραπέζι ${bill.table.name}` : bill.label ?? "Λογαριασμός";
  const open = bill.status === "OPEN";
  const seats = seatsOf(bill, bill.table?.seats);
  const heldRound = new Map(bill.rounds.map((r) => [r.id, !!r.held]));
  const due = seatDue(bill.lines);
  const left = bill.dueCents - bill.heldCents;
  const shown = bill.lines.filter((l) => !seat || l.seat === seat);
  const held = bill.rounds.filter((r) => r.held && bill.lines.some((l) => l.roundId === r.id && !l.voidedAt));
  const empty = bill.totalCents === 0 && bill.paidCents === 0 && !held.length;
  const lastRound = [...bill.rounds].reverse().find((r) => !r.held && bill.lines.some((l) => l.roundId === r.id && !l.voidedAt));
  const unserved = bill.lines.filter((l) => !l.servedAt && !l.voidedAt && !heldRound.get(l.roundId));
  const seatLeft = seat ? due.get(seat) ?? 0 : left;

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: compact ? 14 : 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: t.divider }}>
      {onBack || mode === "pay" ? <Pressable onPress={mode === "pay" ? () => setMode("bill") : onBack} accessibilityRole="button" accessibilityLabel={mode === "pay" ? "Πίσω στο τραπέζι" : "Πίσω στα τραπέζια"} hitSlop={8} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: t.card }}><ArrowLeft {...ICON} color={t.text} /></Pressable> : null}
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={ty(18, "s", t.text)}>{mode === "pay" ? `Λογαριασμός · ${bill.table ? `Τ${bill.table.name}` : title}` : title}</Text>
        <Text numberOfLines={1} style={[ty(12.5, "m", t.muted), num]}>{[bill.guests ? `${bill.guests} άτομα` : null, durText(minutesSince(bill.openedAt, now)), bill.openedByName].filter(Boolean).join(" · ")}</Text>
      </View>
    </View>
  );

  if (mode === "pay" && open) return (
    <View style={{ flex: 1 }}>{header}
      <PayBody t={t} bill={bill} title={title} startSeat={seat || undefined} cash={cash} methods={methods} method={method} setMethodId={setMethodId} busy={busy || working} onPay={onPay} onShare={onShare}
        onAskCash={() => void act(() => askBill(session, bill.id, true, true))} />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, gap: 6, paddingBottom: 16 }}>
        {seats > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip t={t} label="Όλοι" sub={left ? euro(left).replace(" €", "") : undefined} on={!seat} onPress={() => setSeat(0)} />
            {Array.from({ length: seats }, (_, i) => i + 1).map((n) => <Chip key={n} t={t} label={String(n)} sub={due.get(n) ? euro(due.get(n)!).replace(" €", "") : undefined} on={seat === n} onPress={() => setSeat(n)} />)}
          </ScrollView>
        ) : null}
        {bill.billAskedAt ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 10, backgroundColor: tint(t.wait) }}>
            <ReceiptText {...ICON} color={t.wait} />
            <Text style={[ty(13, "s", t.text), { flex: 1 }]}>Ζήτησαν λογαριασμό {time(bill.billAskedAt)}{bill.billAskedCash ? " · μετρητά στο ταμείο" : ""}</Text>
            {open ? <Pressable onPress={() => void act(() => askBill(session, bill.id, false))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Αναίρεση: δεν ζήτησαν λογαριασμό"><X {...ICON} color={t.muted} /></Pressable> : null}
          </View>
        ) : null}
        {held.map((r) => {
          const ls = bill.lines.filter((l) => l.roundId === r.id && !l.voidedAt);
          return (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, minHeight: 52, paddingLeft: 10, paddingRight: 6, backgroundColor: tint(t.wait) }}>
              <View style={{ flex: 1 }}>
                <Text style={ty(13, "s", t.text)}>Περιμένουν στο «Μετά» · {ls.reduce((n, l) => n + l.quantity, 0)}</Text>
                <Text numberOfLines={1} style={ty(12, "m", t.muted)}>{ls.map((l) => `${l.quantity}× ${l.name}${l.seat ? ` (θ.${l.seat})` : ""}`).join(", ")}</Text>
              </View>
              {open ? <Pressable onPress={() => void act(() => fireRound(session, bill.id, r.id))} disabled={working} accessibilityRole="button" style={({ pressed }) => ({ height: 40, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.action, opacity: working ? 0.4 : pressed ? 0.85 : 1 })}><Flame size={16} strokeWidth={2} color={t.onAction} /><Text style={ty(13.5, "b", t.onAction)}>{"Βγάλ' το"}</Text></Pressable> : null}
            </View>
          );
        })}
        {bill.rounds.length === 0 ? <Text style={[ty(13.5, "m", t.muted), { lineHeight: 20 }]}>Τίποτα ακόμα. Πάτα «Παραγγελία».</Text> : null}
        {[...bill.rounds].reverse().filter((r) => !r.held).map((r) => {
          const ls = shown.filter((l) => l.roundId === r.id);
          if (!ls.length) return null;
          return (
            <View key={r.id} style={{ gap: 0 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, marginBottom: 2 }}>
                <Text style={[ty(11.5, "m", t.faint), num]}>Γύρος {r.number} · {time(r.sentAt)}{r.sentByName && r.sentByName !== bill.openedByName ? ` · ${r.sentByName}` : ""}</Text>
                <Text style={ty(11.5, "m", ls.every((l) => l.servedAt || l.voidedAt) ? t.faint : t.wait)}>{ls.every((l) => l.servedAt || l.voidedAt) ? "σερβιρίστηκε" : "στάλθηκε"}</Text>
              </View>
              {ls.map((l) => {
                const st = lineState(l, heldRound.get(l.roundId) ?? false);
                const on = picked === l.id;
                const o = opts(l.options);
                return (
                  <View key={l.id} style={{ borderTopWidth: 1, borderTopColor: t.divider }}>
                    <Pressable onPress={() => setPicked(on ? undefined : l.id)} disabled={!open || st === "void"} accessibilityRole="button" accessibilityHint="Σερβίρισμα, ξανά το ίδιο, ακύρωση"
                      style={{ minHeight: 44, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: on ? t.card : "transparent", borderRadius: on ? 10 : 0, paddingHorizontal: on ? 8 : 0 }}>
                      <Text style={[ty(13, "m", t.muted), num, { width: 24 }]}>{l.quantity}×</Text>
                      <Text numberOfLines={1} style={[ty(13.5, "s", st === "void" ? t.faint : t.text), { flex: 1, textDecorationLine: st === "void" ? "line-through" : "none" }]}>{l.name}{o || l.note ? <Text style={ty(12, "m", t.muted)}>{` · ${[o, l.note].filter(Boolean).join(" · ")}`}</Text> : null}</Text>
                      {l.seat ? <Seat t={t} n={l.seat} /> : null}
                      {st === "served" ? <Check size={14} strokeWidth={2.5} color={t.ok} accessibilityLabel="σερβιρίστηκε" /> : st === "sent" ? <Clock size={14} strokeWidth={2} color={t.wait} accessibilityLabel="στάλθηκε" /> : st === "void" ? <Text style={ty(11.5, "m", t.faint)}>ακυρ.</Text> : null}
                      <Text style={[ty(13.5, "s", st === "void" ? t.faint : t.text), num, { minWidth: 50, textAlign: "right" }]}>{euro(l.unitPriceCents * l.quantity).replace(" €", "")}</Text>
                    </Pressable>
                    {on ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 8 }}>
                        <Btn t={t} label={l.servedAt ? "Δεν σερβιρίστηκε" : "Σερβιρίστηκε"} Icon={Check} disabled={working} onPress={() => void act(() => markServed(session, bill.id, [l.id], !l.servedAt))} />
                        <Btn t={t} label="Ξανά" Icon={Repeat2} onPress={() => { setPicked(undefined); onAgain([l], title, seats); }} />
                        {l.canVoid ? <Btn t={t} label="Ακύρωση" Icon={Trash2} danger disabled={working} onPress={() => void act(() => voidBillLine(session, bill.id, l.id, "Λάθος παραγγελία"))} /> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
        {open && lastRound ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            <Chip t={t} label={`Ξανά ο γύρος ${lastRound.number}`} on={false} onPress={() => onAgain(bill.lines.filter((l) => l.roundId === lastRound.id && !l.voidedAt), title, seats)} />
            {unserved.length ? <Chip t={t} label={unserved.length === 1 ? "Σερβιρίστηκε" : `Σερβιρίστηκαν όλα · ${unserved.length}`} on={false} onPress={() => void act(() => markServed(session, bill.id, unserved.map((l) => l.id), true))} /> : null}
          </View>
        ) : null}
        {error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>! {error}</Text> : null}
        {!open ? <Text style={ty(13, "m", t.muted)}>Ο λογαριασμός {bill.status === "SETTLED" ? "εξοφλήθηκε" : "ακυρώθηκε"}{bill.closedAt ? ` ${time(bill.closedAt)}` : ""}.</Text> : null}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderTopWidth: 1, borderTopColor: t.divider, backgroundColor: t.panel }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={ty(11.5, "m", t.muted)}>{!open ? "Πληρώθηκαν" : seat ? `Θέση ${seat} χρωστάει` : bill.paidCents ? `Μένουν · πληρ. ${euro(bill.paidCents)}` : "Χρωστάει"}</Text>
          <Text numberOfLines={1} style={[ty(19, "b", t.text), num]}>{euro(open ? seatLeft : bill.paidCents)}</Text>
        </View>
        {open && empty ? (
          <>
            <Btn t={t} label="Κλείσιμο" disabled={working} onPress={() => void act(() => cancelBill(session, bill.id, "Χωρίς παραγγελία"), onBack)} />
            <Btn t={t} primary label="Παραγγελία" Icon={Plus} onPress={() => onAdd(title, seats)} />
          </>
        ) : open ? (
          <>
            <Btn t={t} primary={!left} label={left ? "Παραγγ." : "Παραγγελία"} Icon={Plus} onPress={() => onAdd(title, seats)} />
            {left ? <Btn t={t} primary label="Είσπραξη" disabled={!seatLeft || !!bill.pendingCents} onPress={() => setMode("pay")} /> : null}
          </>
        ) : onBack ? <Btn t={t} primary label="Στα τραπέζια" onPress={onBack} /> : null}
      </View>
    </View>
  );
}

type PayHow = "seat" | "all" | "equal" | "items";

/** Λογαριασμός σε στενή στήλη: ανά θέση (προεπιλογή όταν υπάρχουν θέσεις), όλο, ισόποσα, ανά είδος. */
function PayBody({ t, bill, title, startSeat, cash, methods, method, setMethodId, busy, onPay, onShare, onAskCash }: {
  t: Theme; bill: Bill; title: string; startSeat?: number; cash: boolean; methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void; busy: boolean;
  onPay: (b: Bill, title: string, pick?: { lines: BillPick[]; cents: number; items: number }) => void; onShare: (b: Bill, title: string, cents: number) => void; onAskCash: () => void;
}) {
  const due = seatDue(bill.lines);
  const bySeat = [...due.keys()].some((k) => k > 0) && due.size > 1;
  const [how, setHow] = useState<PayHow>(bill.heldCents ? "equal" : bySeat ? "seat" : "all");
  const [seat, setSeat] = useState<number | undefined>(startSeat && due.has(startSeat) ? startSeat : undefined);
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [people, setPeople] = useState(Math.max(2, bill.guests ?? 2));
  const left = bill.dueCents - bill.heldCents;
  const usable = cash ? methods : methods.filter((m) => m.code !== "cash");
  const m = usable.find((x) => x.id === method?.id) ?? usable[0];
  const share = Math.ceil(left / Math.max(1, people));

  const pick = how === "seat" && seat != null ? seatPick(bill.lines, seat)
    : how === "items" ? bill.lines.filter((l) => items[l.id] && l.remaining > 0).map((l) => ({ lineId: l.id, quantity: l.remaining })) : undefined;
  const pickCents = pick?.reduce((s, p) => s + p.quantity * (bill.lines.find((l) => l.id === p.lineId)?.unitPriceCents ?? 0), 0) ?? 0;
  const amount = how === "all" ? left : how === "equal" ? Math.min(share, left) : pickCents;
  const go = () => {
    if (how === "all") onPay(bill, title);
    else if (how === "equal") { if (share >= left) onPay(bill, title); else onShare(bill, title, share); }
    else if (pick?.length) onPay(bill, title, { lines: pick, cents: pickCents, items: pick.reduce((n, p) => n + p.quantity, 0) });
  };
  const hows: [PayHow, string][] = [["all", "Όλο"], ...(bySeat && !bill.heldCents ? [["seat", "Θέση"] as [PayHow, string]] : []), ["equal", "Ίσα"], ...(!bill.heldCents ? [["items", "Είδος"] as [PayHow, string]] : [])];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text style={ty(13.5, "m", t.muted)}>Μένουν{bill.paidCents + bill.heldCents ? ` · πληρώθηκαν ${euro(bill.paidCents + bill.heldCents)}` : ""}</Text>
          <Text style={[ty(26, "b", t.text), num]}>{euro(left)}</Text>
        </View>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", backgroundColor: t.raised, borderRadius: 12, padding: 3, gap: 3 }}>
          {hows.map(([k, label]) => (
            <Pressable key={k} onPress={() => setHow(k)} accessibilityRole="radio" accessibilityState={{ checked: how === k }} style={{ flex: 1, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: how === k ? t.text : "transparent" }}>
              <Text style={ty(13.5, "s", how === k ? t.ink : t.muted)}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {how === "seat" ? [...due].sort((a, b) => (a[0] || 99) - (b[0] || 99)).map(([n, c]) => (
          <Pressable key={n} onPress={() => setSeat(n)} accessibilityRole="radio" accessibilityState={{ checked: seat === n }} style={{ minHeight: 56, borderRadius: 14, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.card, borderWidth: 2, borderColor: seat === n ? t.text : "transparent" }}>
            {n ? <Seat t={t} n={n} /> : <View style={{ width: 22 }} />}
            <View style={{ flex: 1 }}>
              <Text style={ty(14, "s", t.text)}>{n ? `Θέση ${n}` : "Κοινά (χωρίς θέση)"}</Text>
              <Text numberOfLines={1} style={ty(12, "m", t.muted)}>{bill.lines.filter((l) => l.remaining > 0 && (l.seat ?? 0) === n).map((l) => `${l.remaining}× ${l.name}`).join(", ")}</Text>
            </View>
            <Text style={[ty(15, "b", t.text), num]}>{euro(c)}</Text>
          </Pressable>
        )) : null}
        {how === "items" ? bill.lines.filter((l) => l.remaining > 0).map((l) => (
          <Pressable key={l.id} onPress={() => setItems((x) => ({ ...x, [l.id]: !x[l.id] }))} accessibilityRole="checkbox" accessibilityState={{ checked: !!items[l.id] }} style={{ minHeight: 50, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: items[l.id] ? t.raised : t.card }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: items[l.id] ? t.text : t.faint, backgroundColor: items[l.id] ? t.text : "transparent", alignItems: "center", justifyContent: "center" }}>{items[l.id] ? <Check size={14} strokeWidth={3} color={t.ink} /> : null}</View>
            <Seat t={t} n={l.seat} />
            <Text numberOfLines={1} style={[ty(14, "s", t.text), { flex: 1 }]}>{l.remaining}× {l.name}</Text>
            <Text style={[ty(14, "s", t.text), num]}>{euro(l.remaining * l.unitPriceCents)}</Text>
          </Pressable>
        )) : null}
        {how === "equal" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.card, borderRadius: 14, padding: 12 }}>
            <Text style={[ty(14, "m", t.muted), { flex: 1 }]}>Σε πόσους</Text>
            <Pressable onPress={() => setPeople(Math.max(2, people - 1))} accessibilityRole="button" accessibilityLabel="Ένας λιγότερος" style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Text style={ty(20, "s", t.text)}>−</Text></Pressable>
            <Text style={[ty(20, "b", t.text), num, { minWidth: 28, textAlign: "center" }]}>{people}</Text>
            <Pressable onPress={() => setPeople(Math.min(20, people + 1))} accessibilityRole="button" accessibilityLabel="Ένας παραπάνω" style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Text style={ty(20, "s", t.text)}>+</Text></Pressable>
          </View>
        ) : null}
        {how === "equal" ? <Text style={ty(12.5, "m", t.muted)}>{euro(Math.min(share, left))} ο καθένας. Η απόδειξη βγαίνει με το τελευταίο μερίδιο.</Text> : null}
        {how === "seat" && due.has(0) ? <Text style={ty(12.5, "m", t.faint)}>Τα κοινά πληρώνονται χωριστά ή μαζί με το «Όλο».</Text> : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: t.divider }}>
        {usable.length > 1 ? (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {usable.map((x) => { const on = x.id === m?.id; const I = x.code === "cash" ? Banknote : CreditCard; return (
              <Pressable key={x.id} onPress={() => setMethodId(x.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: on ? t.text : t.line, backgroundColor: on ? t.raised : "transparent" }}>
                <I size={16} strokeWidth={1.75} color={on ? t.text : t.muted} /><Text style={ty(13.5, "s", on ? t.text : t.muted)}>{x.name}</Text>
              </Pressable>); })}
          </View>
        ) : null}
        <Pressable onPress={() => { if (m && m.id !== method?.id) setMethodId(m.id); go(); }} disabled={busy || !m || amount <= 0 || bill.shares.some((x) => x.status === "PENDING")} accessibilityRole="button"
          style={({ pressed }) => ({ height: 56, borderRadius: 16, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: busy || !m || amount <= 0 ? 0.35 : pressed ? 0.85 : 1 })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{m?.code === "cash" ? <Banknote {...ICON} color={t.onAction} /> : <CreditCard {...ICON} color={t.onAction} />}<Text style={ty(16, "s", t.onAction)}>{busy ? "Περίμενε…" : m?.code === "cash" ? "Μετρητά" : "Κάρτα στο τερματικό"}</Text></View>
          <Text style={[ty(16, "b", t.onAction), num]}>{euro(amount)}</Text>
        </Pressable>
        {!cash ? <Btn t={t} label={bill.billAskedCash ? "Ο ταμίας ειδοποιήθηκε για μετρητά" : "Μετρητά · ειδοποίηση ταμία"} Icon={Banknote} disabled={busy || !!bill.billAskedCash} onPress={onAskCash} /> : null}
      </View>
    </View>
  );
}

// ---- Παραγγελία (κινητό): πάτημα = +1, θέση, «Τώρα / Μετά» ----

export type OrderTile = { i: number; name: string; color: string };
export type OrderCartLine = { key: string; name: string; quantity: number; cents: number; opts: string; note: string; seat?: number; color: string };

/**
 * Πλέγμα δύο στηλών για το κινητό. Πάτημα = +1 (ή φύλλο επιλογών), παρατεταμένο πάτημα = «Τελείωσε / Υπάρχει ξανά».
 * mode table: «Μετά» και «Στείλε τώρα»· mode sale: τρόπος πληρωμής και «Είσπραξη».
 */
export function PhoneOrder({ t, title, seats, seat, setSeat, tiles, tab, setTab, query, setQuery, products, colorOf, inCart, soldOut, lines, totalCents, busy, mode, methods, method, setMethodId, onTap, onToggleSoldOut, onQty, onEdit, onClear, onSend, onCharge, onBack }: {
  t: Theme; title: string; seats: number; seat?: number; setSeat: (n: number | undefined) => void;
  tiles: OrderTile[]; tab: number; setTab: (i: number) => void; query: string; setQuery: (q: string) => void;
  products: Product[]; colorOf: (p: Product) => string; inCart: (id: string) => number; soldOut: ReadonlySet<string>;
  lines: OrderCartLine[]; totalCents: number; busy: boolean; mode: "table" | "sale";
  methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void;
  onTap: (p: Product) => void; onToggleSoldOut: (p: Product) => void; onQty: (key: string, q: number) => void; onEdit: (key: string) => void; onClear: () => void;
  onSend: (held: boolean) => void; onCharge: () => void; onBack?: () => void;
}) {
  const [cartOpen, setCartOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [extra, setExtra] = useState(0); // «+ θέση»: κάθισε κι άλλος
  const items = lines.reduce((n, l) => n + l.quantity, 0);
  const plain = (p: Product) => !p.groups.some((g) => g.kind === "REQUIRED");
  const shownSeats = seats ? seats + extra : 0;
  const cartSeats = [...new Set(lines.map((l) => l.seat).filter((x): x is number => !!x))].sort((a, b) => a - b);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 56 }}>
        {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Πίσω στον λογαριασμό" hitSlop={8} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: t.card }}><ArrowLeft {...ICON} color={t.text} /></Pressable> : null}
        {searching || query ? (
          <View style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: t.panel, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
            <Search size={16} strokeWidth={1.75} color={t.faint} />
            <TextInput value={query} onChangeText={setQuery} autoFocus placeholder="Αναζήτηση" placeholderTextColor={t.faint} autoCorrect={false} accessibilityLabel="Αναζήτηση προϊόντος" style={{ ...ty(15, "m", t.text), flex: 1, height: 44 }} />
            <Pressable onPress={() => { setQuery(""); setSearching(false); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Κλείσιμο αναζήτησης"><X size={16} strokeWidth={1.75} color={t.muted} /></Pressable>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" numberOfLines={1} style={ty(17, "s", t.text)}>{title}</Text>
              {mode === "table" ? <Text style={ty(12, "m", t.muted)}>νέος γύρος{seat ? ` · θέση ${seat}` : shownSeats > 1 ? " · όλο το τραπέζι" : ""}</Text> : null}
            </View>
            <Pressable onPress={() => setSearching(true)} accessibilityRole="button" accessibilityLabel="Αναζήτηση" hitSlop={4} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: t.card }}><Search {...ICON} color={t.text} /></Pressable>
          </>
        )}
      </View>
      {shownSeats > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingBottom: 6 }}>
          <Chip t={t} label="Όλοι" on={!seat} onPress={() => setSeat(undefined)} />
          {Array.from({ length: shownSeats }, (_, i) => i + 1).map((n) => <Chip key={n} t={t} label={String(n)} on={seat === n} onPress={() => setSeat(n)} />)}
          <Chip t={t} label="+ θέση" on={false} onPress={() => { setExtra((x) => x + 1); setSeat(shownSeats + 1); }} />
        </ScrollView>
      ) : null}
      {!query ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
          {tiles.map((x) => <Chip key={x.i} t={t} label={x.name} on={tab === x.i} onPress={() => setTab(x.i)} />)}
        </ScrollView>
      ) : null}
      <FlatList data={products} keyExtractor={(p) => p.id} numColumns={3} columnWrapperStyle={{ gap: 6 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 2 }} style={{ flex: 1 }}
        ListEmptyComponent={<Text style={[ty(13.5, "m", t.muted), { paddingVertical: 8 }]}>{query ? "Κανένα προϊόν δεν ταιριάζει." : "Η κατηγορία δεν έχει προϊόντα."}</Text>}
        renderItem={({ item: p }) => {
          const out = soldOut.has(p.id);
          const n = inCart(p.id);
          const color = colorOf(p);
          return (
            <Pressable onPress={() => { if (out) return; Vibration.vibrate(10); onTap(p); }} onLongPress={() => onToggleSoldOut(p)} delayLongPress={600} accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${euro(p.priceCents)}${out ? ", τελείωσε" : ""}${n ? `, ${n} στην παραγγελία` : ""}`} accessibilityHint="Παρατεταμένο πάτημα: τελείωσε ή υπάρχει ξανά"
              style={({ pressed }) => ({ flex: 1 / 3, height: 70, borderRadius: 12, padding: 8, backgroundColor: color, opacity: out ? 0.4 : pressed ? 0.8 : 1, justifyContent: "space-between", transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <Text numberOfLines={2} style={[ty(13, "s", t.ink), { lineHeight: 16, paddingRight: n ? 22 : 0 }]}>{p.name}</Text>
              <Text numberOfLines={1} style={[ty(12, out ? "s" : "m", t.ink), { opacity: out ? 1 : 0.7 }, num]}>{out ? "Τελείωσε" : `${euro(p.priceCents).replace(" €", "")}${plain(p) ? "" : " ›"}`}</Text>
              {n ? <View style={{ position: "absolute", top: 6, right: 6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: t.ink, alignItems: "center", justifyContent: "center" }}><Text style={[ty(11.5, "b", t.text), num]}>{n}</Text></View> : null}
            </Pressable>
          );
        }} />

      {cartOpen && lines.length ? (
        <View style={{ maxHeight: 300, borderTopWidth: 1, borderTopColor: t.divider, backgroundColor: t.panel }}>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
            {lines.map((l) => (
              <View key={l.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderLeftWidth: 3, borderLeftColor: l.color, paddingLeft: 8 }}>
                <Seat t={t} n={l.seat} />
                <Pressable onPress={() => onEdit(l.key)} style={{ flex: 1, minHeight: 44, justifyContent: "center" }} accessibilityRole="button" accessibilityHint="Επιλογές και σημείωση">
                  <Text numberOfLines={1} style={ty(14, "s", t.text)}>{l.name}</Text>
                  {l.opts || l.note ? <Text numberOfLines={1} style={ty(12, "m", t.muted)}>{[l.opts, l.note].filter(Boolean).join(" · ")}</Text> : null}
                </Pressable>
                <Pressable onPress={() => onQty(l.key, l.quantity - 1)} accessibilityRole="button" accessibilityLabel={`Ένα λιγότερο ${l.name}`} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Text style={ty(18, "s", t.text)}>−</Text></Pressable>
                <Text style={[ty(15, "b", t.text), num, { minWidth: 22, textAlign: "center" }]}>{l.quantity}</Text>
                <Pressable onPress={() => onQty(l.key, l.quantity + 1)} accessibilityRole="button" accessibilityLabel={`Ένα ακόμα ${l.name}`} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Text style={ty(18, "s", t.text)}>+</Text></Pressable>
              </View>
            ))}
            <Pressable onPress={() => { onClear(); setCartOpen(false); }} accessibilityRole="button" style={{ alignSelf: "flex-start", paddingVertical: 8 }}><Text style={ty(13, "s", t.bad)}>Άδειασμα</Text></Pressable>
          </ScrollView>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10, gap: 6, borderTopWidth: 1, borderTopColor: t.divider, backgroundColor: t.panel }}>
        <Pressable onPress={() => setCartOpen((o) => !o)} disabled={!lines.length} accessibilityRole="button" accessibilityLabel={`${items} είδη, ${euro(totalCents)}. Πάτα για λεπτομέρειες`} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text numberOfLines={1} style={[ty(13.5, "s", items ? t.text : t.muted), num]}>{items ? `${items} ${items === 1 ? "είδος" : "είδη"}` : "Πάτα ένα είδος"}</Text>
          {cartSeats.length ? <Text numberOfLines={1} style={[ty(12.5, "m", t.muted), num]}>· {cartSeats.length === 1 ? "θέση" : "θέσεις"} {cartSeats.join(", ")}</Text> : null}
          {items ? <ChevronUp size={16} strokeWidth={2} color={t.muted} style={{ transform: [{ rotate: cartOpen ? "180deg" : "0deg" }] }} /> : null}
          <View style={{ flex: 1 }} />
          {items ? <Text style={[ty(14, "b", t.text), num]}>{euro(totalCents)}</Text> : null}
        </Pressable>
        {mode === "table" ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn t={t} label="Μετά" Icon={Pause} flex={1} disabled={busy || !items} onPress={() => onSend(true)} />
            <Btn t={t} primary label={busy ? "Περίμενε…" : "Στείλε τώρα"} Icon={Send} flex={2} disabled={busy || !items} onPress={() => onSend(false)} />
          </View>
        ) : (
          <>
            {methods.length > 1 ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                {methods.map((x) => { const on = x.id === method?.id; const I = x.code === "cash" ? Banknote : CreditCard; return (
                  <Pressable key={x.id} onPress={() => setMethodId(x.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: on ? t.text : t.line, backgroundColor: on ? t.raised : "transparent" }}>
                    <I size={16} strokeWidth={1.75} color={on ? t.text : t.muted} /><Text style={ty(13.5, "s", on ? t.text : t.muted)}>{x.name}</Text>
                  </Pressable>); })}
              </View>
            ) : null}
            <Pressable onPress={onCharge} disabled={busy || !totalCents || !method} accessibilityRole="button" style={({ pressed }) => ({ height: 56, borderRadius: 16, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: busy || !totalCents || !method ? 0.35 : pressed ? 0.85 : 1 })}>
              <Text style={ty(16, "s", t.onAction)}>{busy ? "Περίμενε…" : "Είσπραξη"}</Text>
              <Text style={[ty(16, "b", t.onAction), num]}>{euro(totalCents)}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

/** Μετά την αποστολή: τι πήγε, για ποιο τραπέζι, και αν κάτι περιμένει στο «Μετά». */
export function SentView({ t, title, number, held, lines, onTables, onBill }: { t: Theme; title: string; number: number; held: boolean; lines: OrderCartLine[]; onTables: () => void; onBill: () => void }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, gap: 12, flexGrow: 1 }}>
      <View style={{ alignItems: "center", gap: 8, paddingTop: 20, paddingBottom: 6 }} accessibilityLiveRegion="polite">
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: tint(held ? t.wait : t.ok), alignItems: "center", justifyContent: "center" }}>{held ? <Pause size={26} strokeWidth={2} color={t.wait} /> : <Check size={28} strokeWidth={2.5} color={t.ok} />}</View>
        <Text style={ty(19, "s", t.text)}>{held ? `Ο γύρος ${number} περιμένει` : `Ο γύρος ${number} στάλθηκε`}</Text>
        <Text style={[ty(13, "m", t.muted), { textAlign: "center", lineHeight: 19 }]}>{held ? `${title}. Δεν πήγε σε κουζίνα ή bar. Πάτα «Βγάλ' το» στο τραπέζι όταν είναι η ώρα.` : `${title}. Πήγε σε κουζίνα και bar.`}</Text>
      </View>
      <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 12, gap: 4 }}>
        {lines.map((l) => (
          <View key={l.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34 }}>
            <Seat t={t} n={l.seat} />
            <Text numberOfLines={1} style={[ty(14, "s", t.text), { flex: 1 }]}>{l.quantity}× {l.name}</Text>
            {l.opts ? <Text numberOfLines={1} style={[ty(12, "m", t.muted), { maxWidth: "40%" }]}>{l.opts}</Text> : null}
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <Btn t={t} primary label="Πίσω στα τραπέζια" onPress={onTables} />
      <Btn t={t} label={`Ξανά στο ${title}`} onPress={onBill} />
    </ScrollView>
  );
}
