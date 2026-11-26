// Κρατήσεις τραπεζιών στο ταμείο. Ύφος: docs/mockups/central-till/reservations.html (καρέ 2 λίστα ημέρας, καρέ 3 νέα κράτηση).
// Μοβ = κράτηση, πορτοκαλί = αργεί / γεμάτη ώρα, πράσινο = κάθισαν. Το «Ήρθαν» ανοίγει λογαριασμό στο τραπέζι.
import { AlarmClock, Armchair, Ban, CalendarPlus, Check, Clock, MessageSquare, Phone, Table2, TriangleAlert, UserX, Users, X, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError, type DiningTable, getBills, type Session } from "./api";
import { busyTables, type Day, fits, type Guest, hhmm, isoDay, type Phase, type Reservation, slots, untilText } from "./reservations";
import { closeReservation, createReservation, findGuest, getDay, seatReservation } from "./reservations-api";
import { type Theme, tint, ty } from "./theme";

const num = { fontVariant: ["tabular-nums" as const] };
const fail = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : e instanceof ApiError && e.status === 0 ? "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά." : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const unpaired = (e: unknown) => e instanceof ApiError && e.status === 401;
const people = (n: number) => `${n} ${n === 1 ? "άτομο" : "άτομα"}`;

/** Ετικέτα κατάστασης: χρώμα, εικονίδιο και κείμενο (ποτέ μόνο χρώμα). */
function status(t: Theme, r: Reservation, now: Date): { color: string; Icon: LucideIcon; text: string } {
  const by: Record<Phase, () => { color: string; Icon: LucideIcon; text: string }> = {
    late: () => ({ color: t.wait, Icon: AlarmClock, text: untilText(r.startsAt, now).replace("αργεί", "Αργεί") }),
    soon: () => ({ color: t.categories[1], Icon: Clock, text: untilText(r.startsAt, now) }),
    later: () => ({ color: t.categories[1], Icon: Clock, text: "Κλεισμένη" }),
    seated: () => ({ color: t.ok, Icon: Armchair, text: "Κάθισαν" }),
    done: () => ({ color: t.faint, Icon: Check, text: "Έφυγαν" }),
    no_show: () => ({ color: t.bad, Icon: UserX, text: "Δεν ήρθαν" }),
    cancelled: () => ({ color: t.faint, Icon: Ban, text: "Ακυρώθηκε" }),
  };
  return by[r.phase]();
}

function Btn({ t, label, onPress, primary, disabled, Icon, danger }: { t: Theme; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; Icon?: LucideIcon; danger?: boolean }) {
  const c = primary ? t.onAction : danger ? t.bad : t.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, borderRadius: 12, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: primary ? t.action : pressed ? t.raised : "transparent", borderWidth: primary ? 0 : 1, borderColor: t.line, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}>
      {Icon ? <Icon size={18} strokeWidth={1.75} color={c} /> : null}
      <Text style={[ty(14, "s", c), num]}>{label}</Text>
    </Pressable>
  );
}

/** Επιλογή από λίστα κουμπιών σε πλέγμα (ημέρα, ώρα, τραπέζι). */
export function Chip({ t, label, sub, on, off, onPress, w }: { t: Theme; label: string; sub?: string; on?: boolean; off?: boolean; onPress: () => void; w?: number }) {
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!off }} accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={({ pressed }) => ({ width: w, minWidth: 64, height: sub ? 52 : 44, paddingHorizontal: 10, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: on ? t.categories[1] : off ? "transparent" : pressed ? t.raised : t.card, borderWidth: off ? 1 : 0, borderStyle: "dashed", borderColor: t.line })}>
      <Text style={[ty(14, "b", on ? t.ink : off ? t.faint : t.text), num, off && !sub ? { textDecorationLine: "line-through" } : null]}>{label}</Text>
      {sub ? <Text numberOfLines={1} style={ty(11.5, "m", on ? t.ink : t.faint)}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Sheet({ t, title, onClose, children, width = 560 }: { t: Theme; title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.55)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Κλείσιμο" />
        <View style={{ width, maxWidth: "100%", backgroundColor: t.panel, borderLeftWidth: 1, borderLeftColor: t.divider }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 }}>
            <Text accessibilityRole="header" style={[ty(20, "s", t.text), { flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Κλείσιμο" style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.raised : t.card })}><X size={18} strokeWidth={1.75} color={t.text} /></Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export const field = (t: Theme) => ({ height: 48, borderRadius: 12, backgroundColor: t.card, paddingHorizontal: 14, ...ty(16, "s", t.text) });
export const label = (t: Theme) => ty(12.5, "s", t.muted);

// ---- Νέα κράτηση (καρέ 3) ----

function NewReservation({ t, session, now, tables, initialDate, onClose, onSaved, onUnpaired }: {
  t: Theme; session: Session; now: Date; tables: DiningTable[]; initialDate: string; onClose: () => void; onSaved: (date: string) => void; onUnpaired: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [guest, setGuest] = useState<Guest | null>(null);
  const [guests, setGuests] = useState(2);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState<Date>();
  const [tableId, setTableId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [day, setDay] = useState<Day>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { getDay(session, date).then(setDay, (e) => (unpaired(e) ? onUnpaired() : setError(fail(e)))); }, [session, date, onUnpaired]);
  // Πελάτης που ξανάρχεται: φέρνει όνομα και σημείωση από το τηλέφωνο
  const lookup = (value: string) => {
    setPhone(value);
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10) return setGuest(null);
    findGuest(session, digits).then((g) => { setGuest(g); if (g) setName((n) => n || g.name); }, () => setGuest(null));
  };

  const all = day?.reservations ?? [];
  const times = slots(date, now);
  const taken = time ? busyTables(all, time) : new Set<string>();
  const table = tables.find((x) => x.id === tableId);
  const ok = !!time && name.trim().length > 0 && !busy && !(tableId && taken.has(tableId));

  const save = async () => {
    if (!time) return;
    setBusy(true); setError(undefined);
    try {
      await createReservation(session, { tableId, startsAt: time.toISOString(), guests, name: name.trim(), phone: phone.trim() || undefined, note: note.trim() || undefined });
      onSaved(date);
    } catch (e) { if (unpaired(e)) onUnpaired(); else setError(fail(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet t={t} title="Νέα κράτηση" onClose={onClose}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, gap: 6 }}><Text style={label(t)}>Τηλέφωνο</Text><TextInput value={phone} onChangeText={lookup} keyboardType="phone-pad" autoComplete="tel" placeholder="69…" placeholderTextColor={t.faint} style={[field(t), num]} accessibilityLabel="Τηλέφωνο" /></View>
          <View style={{ flex: 1, gap: 6 }}><Text style={label(t)}>Όνομα</Text><TextInput value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" placeholder="Ονοματεπώνυμο" placeholderTextColor={t.faint} style={field(t)} accessibilityLabel="Όνομα" /></View>
        </View>
        {guest ? (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {guest.noShows ? <TriangleAlert size={14} strokeWidth={2} color={t.wait} /> : <Check size={14} strokeWidth={2} color={t.ok} />}
            <Text style={[ty(12.5, "m", t.muted), { flex: 1 }, num]}>Υπάρχει ήδη: {guest.visits} {guest.visits === 1 ? "κράτηση" : "κρατήσεις"}, {guest.noShows ? `${guest.noShows} που δεν ήρθε` : "καμία που δεν ήρθε"}{guest.lastNote ? ` · «${guest.lastNote}»` : ""}</Text>
          </View>
        ) : null}
        {guest?.usual?.length ? <GuestUsual t={t} guest={guest} /> : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ gap: 6 }}>
            <Text style={label(t)}>Άτομα</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Chip t={t} label="−" onPress={() => setGuests(Math.max(1, guests - 1))} w={48} />
              <View style={{ width: 64, height: 44, borderRadius: 10, backgroundColor: t.card, alignItems: "center", justifyContent: "center" }}><Text accessibilityLabel={people(guests)} style={[ty(17, "b", t.text), num]}>{guests}</Text></View>
              <Chip t={t} label="+" onPress={() => setGuests(Math.min(40, guests + 1))} w={48} />
            </View>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={label(t)}>Ημέρα</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[["Σήμερα", 0], ["Αύριο", 1], ["Μεθαύριο", 2]].map(([l, o]) => { const d = isoDay(now, o as number); return <Chip key={d} t={t} label={l as string} on={date === d} onPress={() => { if (d !== date) setDay(undefined); setDate(d); setTime(undefined); setTableId(null); }} />; })}
            </View>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={label(t)}>Ώρα{day ? "" : " · φορτώνει…"}</Text>
          {times.length === 0 ? <Text style={ty(13, "m", t.muted)}>Δεν μένουν ώρες σήμερα. Διάλεξε άλλη ημέρα.</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {times.map((s) => { const full = !!day && !fits(all, day.seats, s, guests); return <Chip key={s.toISOString()} t={t} label={hhmm(s)} w={76} on={time?.getTime() === s.getTime()} off={full} onPress={() => setTime(s)} />; })}
          </View>
          {day && times.some((s) => !fits(all, day.seats, s, guests)) ? <Text style={ty(12, "m", t.faint)}>Διαγραμμένη ώρα: δεν χωράνε {guests} ακόμη άτομα σε όλο το κατάστημα.</Text> : null}
        </View>
        <View style={{ gap: 6 }}>
          <Text style={label(t)}>Τραπέζι, προαιρετικά{time ? "" : " · διάλεξε πρώτα ώρα"}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {tables.map((x) => { const busyHere = taken.has(x.id); return <Chip key={x.id} t={t} label={x.name} sub={busyHere ? "κλεισμένο" : `${x.seats} θέσεις`} w={70} on={tableId === x.id} off={!time || busyHere} onPress={() => setTableId(tableId === x.id ? null : x.id)} />; })}
          </View>
          {table && table.seats < guests ? <Text style={ty(12, "m", t.wait)}>Το τραπέζι {table.name} έχει {table.seats} θέσεις για {guests} άτομα.</Text> : null}
        </View>
        <View style={{ gap: 6 }}><Text style={label(t)}>Σημείωση</Text><TextInput value={note} onChangeText={setNote} maxLength={200} placeholder="π.χ. γενέθλια, καρεκλάκι μωρού, αλλεργία" placeholderTextColor={t.faint} style={[field(t), ty(15, "m", t.text)]} accessibilityLabel="Σημείωση" /></View>
        {error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>! {error}</Text> : null}
        <Pressable onPress={save} disabled={!ok} accessibilityRole="button" accessibilityState={{ disabled: !ok }}
          style={({ pressed }) => ({ height: 56, borderRadius: 28, backgroundColor: t.action, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, opacity: !ok ? 0.4 : pressed ? 0.85 : 1 })}>
          <Text style={ty(16, "s", t.onAction)}>{busy ? "Αποθηκεύεται…" : "Κράτηση"}</Text>
          <Text style={[ty(15, "b", t.onAction), num]}>{[time ? hhmm(time) : "διάλεξε ώρα", people(guests), table ? `τραπ. ${table.name}` : null].filter(Boolean).join(" · ")}</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

// ---- Ενέργειες σε κράτηση ----

function Actions({ t, session, r, now, tables, openTables, onClose, onDone, onOpenBill, onUnpaired }: {
  t: Theme; session: Session; r: Reservation; now: Date; tables: DiningTable[]; openTables: Set<string>; onClose: () => void; onDone: () => void; onOpenBill: (billId: string) => void; onUnpaired: () => void;
}) {
  const [pick, setPick] = useState<string | null>(r.tableId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await f(); } catch (e) { if (unpaired(e)) onUnpaired(); else setError(fail(e)); } finally { setBusy(false); }
  };
  const s = status(t, r, now);
  const booked = r.status === "BOOKED";
  return (
    <Sheet t={t} title={`${hhmm(r.startsAt)} · ${r.name}`} onClose={onClose} width={480}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: tint(s.color.length === 7 ? s.color : t.faint) }}><s.Icon size={14} strokeWidth={2} color={s.color} /><Text style={[ty(12.5, "s", s.color), num]}>{s.text}</Text></View>
          <Text style={[ty(13, "m", t.muted), num]}>{people(r.guests)}{r.tableName ? ` · τραπέζι ${r.tableName}` : " · χωρίς τραπέζι"}{r.phone ? ` · ${r.phone}` : ""}</Text>
        </View>
        {r.note ? <View style={{ flexDirection: "row", gap: 8, backgroundColor: t.card, borderRadius: 12, padding: 12 }}><MessageSquare size={16} strokeWidth={1.75} color={t.text} /><Text style={[ty(13.5, "m", t.text), { flex: 1, lineHeight: 19 }]}>{r.note}</Text></View> : null}
        {booked ? (
          <View style={{ gap: 6 }}>
            <Text style={label(t)}>Τραπέζι για να καθίσουν</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {tables.map((x) => { const occupied = openTables.has(x.id); return <Chip key={x.id} t={t} label={x.name} sub={occupied ? "ανοιχτό" : `${x.seats} θέσεις`} w={70} on={pick === x.id} off={occupied} onPress={() => setPick(x.id)} />; })}
            </View>
          </View>
        ) : null}
        {error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>! {error}</Text> : null}
        {booked ? (
          <>
            <Btn t={t} primary Icon={Armchair} label={busy ? "Ανοίγει…" : pick ? `Ήρθαν · άνοιξε το ${tables.find((x) => x.id === pick)?.name}` : "Ήρθαν · διάλεξε τραπέζι"} disabled={busy || !pick} onPress={() => void run(async () => onOpenBill((await seatReservation(session, r.id, pick ?? undefined)).billId))} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Btn t={t} Icon={UserX} label="Δεν ήρθαν" disabled={busy} onPress={() => void run(async () => { await closeReservation(session, r.id, "no_show"); onDone(); })} /></View>
              <View style={{ flex: 1 }}>{confirmCancel
                ? <Btn t={t} danger Icon={Ban} label="Σίγουρα ακύρωση" disabled={busy} onPress={() => void run(async () => { await closeReservation(session, r.id, "cancel"); onDone(); })} />
                : <Btn t={t} Icon={Ban} label="Ακύρωση κράτησης" disabled={busy} onPress={() => setConfirmCancel(true)} />}</View>
            </View>
          </>
        ) : r.billId ? <Btn t={t} primary Icon={Table2} label="Άνοιξε τον λογαριασμό" onPress={() => onOpenBill(r.billId!)} /> : null}
      </ScrollView>
    </Sheet>
  );
}

// ---- Λίστα ημέρας (καρέ 2) ----

export function ReservationsView({ t, session, now, width, onOpenBill, onUnpaired }: { t: Theme; session: Session; now: Date; width: number; onOpenBill: (billId: string) => void; onUnpaired: () => void }) {
  const today = isoDay(now);
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<Day>();
  const [floor, setFloor] = useState<{ tables: DiningTable[]; open: Set<string> }>({ tables: [], open: new Set() });
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string>();

  const load = useCallback(() => Promise.all([getDay(session, date), getBills(session)]).then(([d, b]) => {
    setDay(d); setError(undefined);
    setFloor({ tables: b.tables, open: new Set(b.bills.map((x) => x.tableId).filter((x): x is string => !!x)) });
  }, (e) => (unpaired(e) ? onUnpaired() : setError(fail(e)))), [session, date, onUnpaired]);
  // Κρατήσεις μπαίνουν και από άλλη συσκευή: ανανέωση κάθε 30''.
  useEffect(() => { void load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const rows = useMemo(() => day?.reservations ?? [], [day]);
  const groups = useMemo(() => {
    if (date !== today) return [{ title: date < today ? "Η ημέρα" : "Κρατήσεις", items: rows, hint: "" }];
    const past = rows.filter((r) => r.phase === "done" || r.phase === "no_show" || r.phase === "cancelled");
    const nowRows = rows.filter((r) => r.phase === "late" || r.phase === "soon" || r.phase === "seated");
    const later = rows.filter((r) => r.phase === "later");
    return [{ title: "Νωρίτερα", items: past, hint: past.length ? `${past.length} έκλεισαν` : "" }, { title: "Τώρα", items: nowRows, hint: "" }, { title: "Αργότερα", items: later, hint: "" }].filter((g) => g.items.length);
  }, [rows, date, today]);

  const wide = width >= 860;
  const activeRows = rows.filter((r) => r.status === "BOOKED" || r.status === "SEATED");
  const late = rows.filter((r) => r.phase === "late").length;
  const noShow = rows.filter((r) => r.phase === "no_show").length;
  const first = Math.min(12, ...activeRows.map((r) => new Date(r.startsAt).getHours())); // πρωινές κρατήσεις μπαίνουν κι αυτές στο γράφημα
  const hours = Array.from({ length: 24 - first }, (_, i) => first + i);
  const fullHour = hours.find((h) => (day?.load[h] ?? 0) >= 95);
  const unassigned = rows.filter((r) => r.status === "BOOKED" && !r.tableId);
  const sel = rows.find((r) => r.id === selected);
  const days: [string, string][] = [["Χθες", isoDay(now, -1)], ["Σήμερα", today], ["Αύριο", isoDay(now, 1)]];

  const row = (r: Reservation) => {
    const s = status(t, r, now);
    const dim = r.phase === "done" || r.phase === "cancelled" || r.phase === "no_show";
    return (
      <Pressable key={r.id} onPress={() => setSelected(r.id)} accessibilityRole="button" accessibilityLabel={`${hhmm(r.startsAt)}, ${r.name}, ${people(r.guests)}, ${r.tableName ? `τραπέζι ${r.tableName}` : "χωρίς τραπέζι"}, ${s.text}`}
        style={({ pressed }) => ({ minHeight: 60, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: pressed ? t.card : t.panel, opacity: dim ? 0.55 : 1, borderWidth: r.phase === "late" ? 2 : 0, borderColor: t.wait })}>
        <Text style={[ty(17, "b", t.text), num, { width: 52 }]}>{hhmm(r.startsAt)}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={ty(14, "s", t.text)}>{r.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Users size={13} strokeWidth={2} color={t.muted} /><Text style={[ty(12.5, "m", t.muted), num]}>{r.guests}</Text>
            {r.note ? <><MessageSquare size={13} strokeWidth={2} color={t.muted} /><Text numberOfLines={1} style={[ty(12.5, "m", t.muted), { flex: 1 }]}>{r.note}</Text></>
              : r.phone ? <><Phone size={13} strokeWidth={2} color={t.muted} /><Text style={[ty(12.5, "m", t.muted), num]}>{r.phone}</Text></> : null}
          </View>
        </View>
        <View style={{ minWidth: 44, height: 32, paddingHorizontal: 10, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: r.tableName ? t.card : tint(t.wait) }}>
          <Text style={ty(r.tableName ? 14 : 12, "b", r.tableName ? t.text : t.wait)}>{r.tableName ?? "χωρίς τραπέζι"}</Text>
        </View>
        <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: tint(s.color.length === 7 ? s.color : t.faint) }}>
          <s.Icon size={14} strokeWidth={2} color={s.color} /><Text style={[ty(12.5, "s", s.color), num]}>{s.text}</Text>
        </View>
      </Pressable>
    );
  };

  const kpi = (value: number, text: string, color = t.text) => (
    <View key={text} style={{ flex: 1, backgroundColor: t.card, borderRadius: 12, padding: 12, gap: 2 }}><Text style={[ty(22, "b", color), num]}>{value}</Text><Text style={ty(12, "m", t.muted)}>{text}</Text></View>
  );
  const side = day ? (
    <View style={{ width: wide ? 360 : undefined, backgroundColor: t.panel, borderRadius: 14, padding: 16, gap: 14 }}>
      <Text style={ty(15, "s", t.text)}>{date === today ? "Σήμερα" : date}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>{[kpi(activeRows.reduce((s, r) => s + r.guests, 0), "άτομα με κράτηση"), kpi(late, "αργούν", late ? t.wait : t.text), kpi(noShow, "δεν ήρθαν", noShow ? t.bad : t.text)]}</View>
      <View style={{ gap: 6 }} accessible accessibilityLabel={`Πληρότητα ανά ώρα: ${hours.map((h) => `${h}:00 ${day.load[h]}%`).join(", ")}`}>
        <Text style={ty(12.5, "m", t.muted)}>Πληρότητα ανά ώρα ({day.seats} θέσεις)</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 110 }}>
          {hours.map((h) => { const v = Math.min(100, day.load[h]); return <View key={h} style={{ flex: 1, height: `${Math.max(4, v)}%`, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: v >= 95 ? t.wait : v >= 60 ? t.categories[1] : t.raised }} />; })}
        </View>
        <View style={{ flexDirection: "row", gap: 4 }}>{hours.map((h) => <Text key={h} style={[ty(11.5, "m", t.faint), num, { flex: 1, textAlign: "center" }]}>{h}</Text>)}</View>
      </View>
      {fullHour != null ? <View style={{ flexDirection: "row", gap: 8, backgroundColor: t.card, borderRadius: 12, padding: 12 }}><TriangleAlert size={18} strokeWidth={1.75} color={t.wait} /><Text style={[ty(12.5, "m", t.muted), { flex: 1, lineHeight: 18 }]}>Στις {fullHour}:00 το κατάστημα είναι γεμάτο. Νέα κράτηση εκείνη την ώρα δεν χωράει.</Text></View> : null}
      {unassigned.map((r) => <View key={r.id} style={{ flexDirection: "row", gap: 8, backgroundColor: t.card, borderRadius: 12, padding: 12 }}><Table2 size={18} strokeWidth={1.75} color={t.text} /><Text style={[ty(12.5, "m", t.muted), { flex: 1, lineHeight: 18 }]}>Η κράτηση {r.name} ({people(r.guests)}, {hhmm(r.startsAt)}) δεν έχει τραπέζι. Δίνεται όταν έρθουν.</Text></View>)}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12, marginBottom: 12, flexWrap: "wrap", borderBottomWidth: 1, borderBottomColor: t.divider }}>
        <Text accessibilityRole="header" style={ty(20, "s", t.text)}>Κρατήσεις</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>{days.map(([l, d]) => <Chip key={d} t={t} label={l} on={date === d} onPress={() => { setDay(undefined); setDate(d); }} />)}</View>
        <View style={{ flex: 1 }} />
        <Btn t={t} primary Icon={CalendarPlus} label="Νέα κράτηση" onPress={() => setAdding(true)} />
      </View>
      {error ? <Text accessibilityLiveRegion="assertive" style={[ty(13, "m", t.bad), { paddingHorizontal: 16 }]}>! {error}</Text> : null}
      {!day ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>{error ? <Btn t={t} label="Δοκίμασε ξανά" onPress={() => void load()} /> : <ActivityIndicator color={t.muted} />}</View> : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16, flexDirection: wide ? "row" : "column", alignItems: "flex-start" }}>
          <View style={{ flex: wide ? 1 : undefined, alignSelf: "stretch", gap: 6 }}>
            {rows.length === 0 ? (
              <View style={{ backgroundColor: t.panel, borderRadius: 14, padding: 20, gap: 12, alignItems: "flex-start" }}>
                <Text style={ty(15, "s", t.text)}>Καμία κράτηση {date === today ? "σήμερα" : "αυτή την ημέρα"}</Text>
                <Text style={[ty(13, "m", t.muted), { lineHeight: 19 }]}>Όταν τηλεφωνήσει πελάτης, πάτα «Νέα κράτηση». Το τραπέζι θα φαίνεται κλεισμένο στην κάτοψη.</Text>
              </View>
            ) : groups.map((g, gi) => (
              <View key={g.title} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingTop: 10, paddingBottom: 4, paddingHorizontal: 2, borderTopWidth: gi ? 1 : 0, borderTopColor: t.divider }}><Text style={ty(13, "s", t.muted)}>{g.title}</Text>{g.hint ? <Text style={ty(12, "m", t.faint)}>{g.hint}</Text> : null}</View>
                {g.items.map(row)}
              </View>
            ))}
          </View>
          {side}
        </ScrollView>
      )}
      {adding ? <NewReservation t={t} session={session} now={now} tables={floor.tables} initialDate={date} onClose={() => setAdding(false)} onUnpaired={onUnpaired}
        onSaved={(d) => { setAdding(false); if (d === date) void load(); else { setDay(undefined); setDate(d); } }} /> : null}
      {sel ? <Actions t={t} session={session} r={sel} now={now} tables={floor.tables} openTables={floor.open} onClose={() => setSelected(undefined)} onUnpaired={onUnpaired}
        onDone={() => { setSelected(undefined); void load(); }} onOpenBill={(id) => { setSelected(undefined); onOpenBill(id); }} /> : null}
    </View>
  );
}


/** «Τι παίρνει συνήθως»: σε πόσες από τις επισκέψεις του υπήρχε κάθε είδος, οι τελευταίες επισκέψεις, το τραπέζι που προτιμά. */
function GuestUsual({ t, guest }: { t: Theme; guest: Guest }) {
  const usual = guest.usual ?? [];
  const day = (iso: string) => new Date(iso).toLocaleDateString("el-GR", { day: "numeric", month: "short", timeZone: "Europe/Athens" });
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, gap: 10 }}>
      <Text style={ty(13, "s", t.text)}>Τι παίρνει συνήθως{guest.favouriteTable ? ` · προτιμά το τραπέζι ${guest.favouriteTable}` : ""}</Text>
      {usual.map((u) => (
        <View key={u.name} style={{ gap: 4 }} accessibilityLabel={`${u.name}: σε ${u.visits} από ${u.of} επισκέψεις`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text numberOfLines={1} style={[ty(12.5, "m", t.text), { flex: 1 }]}>{u.name}</Text>
            <Text style={[ty(12, "m", t.muted), num]}>{u.visits} από {u.of}</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.raised }}><View style={{ width: `${Math.round((u.visits / u.of) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: t.ok }} /></View>
        </View>
      ))}
      {guest.lastVisits?.length ? <Text style={[ty(12, "m", t.muted), num]}>Τελευταίες: {guest.lastVisits.map((v) => `${day(v.at)}${v.table ? ` · ${v.table}` : ""} · ${(v.totalCents / 100).toFixed(2).replace(".", ",")} €`).join("  ·  ")}</Text> : null}
    </View>
  );
}
