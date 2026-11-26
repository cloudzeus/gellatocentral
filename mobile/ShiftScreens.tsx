// Βάρδιες ταμία: είσοδος με PIN, κλείσιμο βάρδιας με μέτρηση συρταριού, κλείσιμο ημέρας ανά ταμία.
// Εγκεκριμένο mockup: docs/mockups/central-till/shifts-till-close.html
import { ArrowLeft, Banknote, Check, CircleCheck, Delete, Lock, LogIn, Minus, Plus, Receipt, RefreshCw, Scale, TrendingUp, TriangleAlert, Undo2, Wallet, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError, type Session } from "./api";
import { countedCents, DENOMS, diffTone, duration, initials, parseEuro, type Tone } from "./drawer";
import { isoDay } from "./reservations";
import { closeDay, closeShift, type DayReport, type Figures, getDayReport, getShift, type ShiftState, startShift } from "./shift-api";
import { euro, type Theme, tint, ty } from "./theme";
import { Btn } from "./TransactionsScreen";

const num = { fontVariant: ["tabular-nums" as const] };
const fail = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : e instanceof ApiError && e.status === 0 ? "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά." : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const unpaired = (e: unknown) => e instanceof ApiError && e.status === 401;
const time = (iso: string | Date) => new Date(iso).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
const euroText = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const toneColor = (t: Theme, tone: Tone) => (tone === "ok" ? t.ok : tone === "wait" ? t.wait : t.bad);
const diffText = (d: number) => (d === 0 ? "Σωστό" : d < 0 ? `Λείπουν ${euro(-d)}` : `Περισσεύουν ${euro(d)}`);
type On = Extract<ShiftState, { on: true }>;

/** Χρώμα από το όνομα: ο ίδιος άνθρωπος έχει το ίδιο χρώμα σε κάθε οθόνη. */
const hue = (name: string) => [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7) % 7;
export function Avatar({ t, name, size = 44 }: { t: Theme; name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.categories[1 + hue(name)], alignItems: "center", justifyContent: "center" }}>
      <Text style={ty(size > 40 ? 14 : 12, "b", t.ink)}>{initials(name)}</Text>
    </View>
  );
}

function Loading({ t }: { t: Theme }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>;
}

function Problem({ t, text, onRetry }: { t: Theme; text: string; onRetry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
      <Text style={[ty(15, "s", t.text), { textAlign: "center" }]}>{text}</Text>
      <Btn t={t} label="Δοκίμασε ξανά" Icon={RefreshCw} onPress={onRetry} />
    </View>
  );
}

// ---- Έναρξη βάρδιας ----

function PinPad({ t, onKey, tall }: { t: Theme; onKey: (k: string) => void; tall: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "del"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {keys.map((k) => (
        <Pressable key={k} onPress={() => onKey(k)} accessibilityRole="button" accessibilityLabel={k === "del" ? "Σβήσιμο" : k === "clear" ? "Καθαρισμός" : k}
          style={({ pressed }) => ({ width: "31.5%", height: tall ? 60 : 54, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: k.length > 1 ? (pressed ? t.card : "transparent") : pressed ? t.raised : t.card })}>
          {k === "del" ? <Delete size={20} strokeWidth={1.75} color={t.muted} /> : <Text style={k === "clear" ? ty(13, "s", t.muted) : [ty(22, "s", t.text), num]}>{k === "clear" ? "Καθαρισμός" : k}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

/** Οθόνη «Ποιος ξεκινά βάρδια;». Χωρίς ανοιχτή βάρδια το ταμείο δεν εισπράττει. */
export function SignInView({ t, session, state, width, place, onStarted, onDay, onUnpaired }: { t: Theme; session: Session; state: On; width: number; place: string; onStarted: () => void; onDay: () => void; onUnpaired: () => void }) {
  const wide = width >= 900;
  const ready = state.staff.filter((e) => !e.onLeave);
  const [sel, setSel] = useState<string | undefined>(wide ? ready[0]?.id : undefined);
  const [pin, setPin] = useState("");
  const [opening, setOpening] = useState(state.suggested ? euroText(state.suggested.cents) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const openingCents = parseEuro(opening);
  const who = state.staff.find((e) => e.id === sel);

  const start = (p = pin) => {
    if (!sel || p.length !== 4 || openingCents == null || busy) return;
    setBusy(true); setError(undefined);
    startShift(session, sel, p, openingCents).then(onStarted, (e) => { if (unpaired(e)) onUnpaired(); else { setError(fail(e)); setPin(""); } }).finally(() => setBusy(false));
  };
  const onKey = (k: string) => {
    setError(undefined);
    if (k === "clear") return setPin("");
    if (k === "del") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length < 4 ? p + k : p));
  };
  const step = (d: number) => setOpening(euroText(Math.max(0, (openingCents ?? 0) + d)));

  if (state.dayClosed) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: t.panel, alignItems: "center", justifyContent: "center" }}><Lock size={24} strokeWidth={1.75} color={t.muted} /></View>
      <Text style={[ty(20, "s", t.text), { textAlign: "center" }]}>Η ημέρα έκλεισε σε αυτό το ταμείο</Text>
      <Text style={[ty(14, "m", t.muted), { textAlign: "center", maxWidth: 460, lineHeight: 20 }]}>Η επόμενη βάρδια ανοίγει από αύριο. Τα σύνολα της ημέρας είναι στην κονσόλα.</Text>
      <Btn t={t} label="Ανανέωση" Icon={RefreshCw} onPress={onStarted} />
    </View>
  );

  const tileW = wide ? (width - 440 - 80 - 24) / 3 : undefined;
  const tiles = state.staff.map((e) => {
    const on = e.id === sel;
    return (
      <Pressable key={e.id} disabled={e.onLeave} onPress={() => { setSel(e.id); setPin(""); setError(undefined); }} accessibilityRole="button" accessibilityState={{ selected: on, disabled: e.onLeave }} accessibilityLabel={e.name}
        style={({ pressed }) => ({ width: tileW, minHeight: 76, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, opacity: e.onLeave ? 0.5 : 1,
          backgroundColor: on ? t.raised : pressed ? t.raised : t.card, borderWidth: on ? 2 : 0, borderColor: "rgba(255,255,255,0.5)" })}>
        <Avatar t={t} name={e.name} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={ty(14, "s", t.text)}>{e.name}</Text>
          <Text numberOfLines={1} style={[ty(12, "m", t.muted), num]}>{e.onLeave ? "Σε άδεια" : e.scheduled ? `Στο πρόγραμμα ${e.scheduled}` : "Όχι στο πρόγραμμα σήμερα"}</Text>
        </View>
      </Pressable>
    );
  });

  const panel = who ? (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {!wide ? <Pressable onPress={() => setSel(undefined)} accessibilityRole="button" accessibilityLabel="Πίσω στα ονόματα" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><ArrowLeft size={20} strokeWidth={1.75} color={t.text} /></Pressable> : null}
        <Avatar t={t} name={who.name} />
        <View style={{ gap: 2 }}><Text style={ty(15, "s", t.text)}>{who.name}</Text><Text style={ty(12.5, "m", t.muted)}>Γράψε το PIN σου</Text></View>
      </View>
      <View style={{ flexDirection: "row", gap: 14, justifyContent: "center", paddingVertical: 4 }} accessibilityLabel={`${pin.length} από 4 ψηφία`}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: i < pin.length ? t.text : t.muted, backgroundColor: i < pin.length ? t.text : "transparent" }} />)}
      </View>
      <PinPad t={t} onKey={onKey} tall={wide} />
      <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 8 }}>
        <Text style={ty(12.5, "m", t.muted)}>Μετρητά στο συρτάρι τώρα</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable onPress={() => step(-500)} accessibilityLabel="5 ευρώ λιγότερα" style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Minus size={18} strokeWidth={1.75} color={t.text} /></Pressable>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextInput value={opening} onChangeText={setOpening} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={t.faint} accessibilityLabel="Μετρητά έναρξης σε ευρώ"
              style={[ty(22, "s", openingCents == null ? t.bad : t.text), num, { flex: 1, paddingVertical: 4 }]} />
            <Text style={ty(22, "s", t.muted)}>€</Text>
          </View>
          <Pressable onPress={() => step(500)} accessibilityLabel="5 ευρώ περισσότερα" style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}><Plus size={18} strokeWidth={1.75} color={t.text} /></Pressable>
        </View>
        <Text style={[ty(12, "m", t.faint), { lineHeight: 17 }]}>
          {state.suggested ? `Η προηγούμενη βάρδια (${state.suggested.by}, ${time(state.suggested.at)}) άφησε ${euro(state.suggested.cents)}. Άλλαξέ το μόνο αν μέτρησες κάτι άλλο.` : "Γράψε πόσα μετρητά έχει το συρτάρι πριν ξεκινήσεις."}
        </Text>
      </View>
      {error ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><TriangleAlert size={16} strokeWidth={1.75} color={t.bad} /><Text style={ty(13, "s", t.bad)}>{error}</Text></View> : null}
      <Btn t={t} primary label={busy ? "Περίμενε…" : "Έναρξη βάρδιας"} Icon={LogIn} disabled={busy || pin.length !== 4 || openingCents == null} onPress={() => start()} />
    </View>
  ) : null;

  const header = (
    <View style={{ gap: 6 }}>
      <Text style={ty(20, "s", t.text)}>Ποιος ξεκινά βάρδια;</Text>
      <Text style={[ty(13.5, "m", t.muted), { lineHeight: 19 }]}>Πάτα το όνομά σου και γράψε το PIN σου. Ό,τι πουλήσεις μετρά στη δική σου βάρδια.</Text>
    </View>
  );
  if (!wide) return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={ty(12.5, "m", t.muted)}>{place}</Text>
      {who ? panel : <>{header}{tiles}<Btn t={t} label="Κλείσιμο ημέρας" Icon={Lock} onPress={onDay} /></>}
    </ScrollView>
  );
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1, padding: 36, gap: 20, borderRightWidth: 1, borderRightColor: t.divider }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.categories[7] }} />
          <Text style={ty(15.5, "b", t.text)}>Gelato System</Text>
          <View style={{ flex: 1 }} />
          <Text style={ty(13, "m", t.muted)}>{place}</Text>
        </View>
        {header}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{tiles}</View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Text style={[ty(12.5, "m", t.faint), { lineHeight: 18, flex: 1 }]}>Βλέπεις μόνο το προσωπικό αυτού του καταστήματος που έχει PIN ταμείου. Νέο άτομο ή PIN: κονσόλα → Προσωπικό.</Text>
          <Btn t={t} label="Κλείσιμο ημέρας" Icon={Lock} onPress={onDay} />
        </View>
      </View>
      <ScrollView style={{ width: 440, flexGrow: 0, backgroundColor: t.panel }} contentContainerStyle={{ padding: 36 }} keyboardShouldPersistTaps="handled">{panel}</ScrollView>
    </View>
  );
}

// ---- Κοινά: κάρτες συνόλων και ωριαίο γράφημα ----

const card = (t: Theme) => ({ backgroundColor: t.panel, borderRadius: 14, padding: 14, gap: 6 }) as const;
function Label({ t, Icon, text }: { t: Theme; Icon: LucideIcon; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon size={15} strokeWidth={1.75} color={t.muted} /><Text style={ty(12.5, "m", t.muted)}>{text}</Text></View>;
}

function SplitBar({ t, card: c, cash }: { t: Theme; card: number; cash: number }) {
  const total = c + cash;
  return (
    <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: c && cash ? 2 : 0, backgroundColor: total ? "transparent" : t.raised }}>
      {c ? <View style={{ flex: c, backgroundColor: t.categories[4] }} /> : null}
      {cash ? <View style={{ flex: cash, backgroundColor: t.categories[2] }} /> : null}
    </View>
  );
}

function Income({ t, f, title, flex }: { t: Theme; f: Figures; title: string; flex?: number }) {
  return (
    <View style={[card(t), { flex }]} accessibilityLabel={`${title} ${euro(f.incomeCents)}, κάρτα ${euro(f.cardCents)}, μετρητά ${euro(f.cashCents)}`}>
      <Label t={t} Icon={TrendingUp} text={title} />
      <Text style={[ty(24, "s", t.text), num]}>{euro(f.incomeCents)}</Text>
      <SplitBar t={t} card={f.cardCents} cash={f.cashCents} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
        {([["Κάρτα", f.cardCents, t.categories[4]], ["Μετρητά", f.cashCents, t.categories[2]]] as const).map(([n, c, color]) => (
          <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} /><Text style={[ty(12.5, "m", t.muted), num]}>{n} {euro(c)}</Text></View>
        ))}
      </View>
    </View>
  );
}

function Hours({ t, f }: { t: Theme; f: Figures }) {
  const max = Math.max(1, ...f.hours.map((h) => h.card + h.cash));
  const peak = f.hours.reduce<Figures["hours"][number] | null>((p, h) => (!p || h.card + h.cash > p.card + p.cash ? h : p), null);
  return (
    <View style={[card(t), { gap: 8 }]} accessibilityLabel={peak ? `Εισπράξεις ανά ώρα. Πιο πολλή κίνηση ${peak.h}:00 με ${euro(peak.card + peak.cash)}` : "Καμία είσπραξη ακόμα"}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={ty(12.5, "m", t.muted)}>Εισπράξεις ανά ώρα</Text>
        <Text style={[ty(12.5, "m", t.muted), num]}>{peak ? `κορυφή ${peak.h}:00–${peak.h + 1}:00 · ${euro(peak.card + peak.cash)}` : "καμία ακόμα"}</Text>
      </View>
      {f.hours.length ? (
        <>
          <View style={{ flexDirection: "row", gap: 8, height: 80, alignItems: "flex-end" }}>
            {f.hours.map((h) => (
              <View key={h.h} style={{ flex: 1, height: "100%", justifyContent: "flex-end", gap: 2 }}>
                {h.cash ? <View style={{ height: `${(h.cash / max) * 100}%`, minHeight: 2, borderRadius: 3, backgroundColor: t.categories[2] }} /> : null}
                {h.card ? <View style={{ height: `${(h.card / max) * 100}%`, minHeight: 2, borderRadius: 3, backgroundColor: t.categories[4] }} /> : null}
                {!h.card && !h.cash ? <View style={{ height: 2, borderRadius: 1, backgroundColor: t.line }} /> : null}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>{f.hours.map((h) => <Text key={h.h} style={[ty(11.5, "m", t.faint), num, { flex: 1, textAlign: "center" }]}>{String(h.h).padStart(2, "0")}</Text>)}</View>
        </>
      ) : <Text style={ty(13, "m", t.faint)}>Δεν έχει γίνει καμία είσπραξη σε αυτή τη βάρδια.</Text>}
    </View>
  );
}

function Line({ t, k, v, strong, first }: { t: Theme; k: string; v: string; strong?: boolean; first?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderTopWidth: first ? 0 : 1, borderTopColor: t.divider }}>
      <Text style={ty(strong ? 14 : 13, strong ? "s" : "m", strong ? t.text : t.muted)}>{k}</Text>
      <Text style={[ty(strong ? 14 : 13, strong ? "s" : "m", t.text), num]}>{v}</Text>
    </View>
  );
}

// ---- Κλείσιμο βάρδιας ----

const REASONS = ["Ρέστα σε πελάτη", "Λάθος στη μέτρηση έναρξης", "Πληρωμή από το συρτάρι"];

export function CloseShiftView({ t, session, width, now, onClosed, onDay, onUnpaired }: { t: Theme; session: Session; width: number; now: Date; onClosed: () => void; onDay: () => void; onUnpaired: () => void }) {
  const wide = width >= 900;
  const [state, setState] = useState<ShiftState>();
  const [error, setError] = useState<string>();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [loose, setLoose] = useState("");
  const [kept, setKept] = useState<string>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const load = useCallback(() => { getShift(session, true).then(setState, (e) => (unpaired(e) ? onUnpaired() : setError(fail(e)))); }, [session, onUnpaired]);
  useEffect(load, [load]);

  if (error) return <Problem t={t} text={error} onRetry={() => { setError(undefined); load(); }} />;
  if (!state) return <Loading t={t} />;
  if (!state.on || !state.shift || !state.report) return <Problem t={t} text="Δεν υπάρχει ανοιχτή βάρδια σε αυτό το ταμείο" onRetry={onClosed} />;
  const { shift, report } = state;
  const f = report.figures;
  const counted = countedCents(counts, loose);
  const touched = loose.trim() !== "" || Object.values(counts).some((v) => v.trim() !== "");
  const diff = counted == null ? 0 : counted - report.expectedCents;
  const tone = diffTone(diff);
  const keptText = kept ?? euroText(Math.min(shift.openingCents, counted ?? 0));
  const keptCents = parseEuro(keptText);
  const keptBad = keptCents == null || (counted != null && keptCents > counted);
  const ready = touched && counted != null && !keptBad && (diff === 0 || reason.trim().length > 0);

  const submit = () => {
    if (!ready || counted == null || keptCents == null) return;
    setBusy(true); setSendError(undefined);
    closeShift(session, counted, keptCents, diff ? reason.trim() : undefined).then(onClosed, (e) => (unpaired(e) ? onUnpaired() : setSendError(fail(e)))).finally(() => setBusy(false));
  };

  const left = (
    <View style={{ gap: 14, flex: wide ? 1 : undefined, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Text style={ty(20, "s", t.text)}>Κλείσιμο βάρδιας</Text>
        <Text style={[ty(13.5, "m", t.muted), num]}>{shift.employee.name} · {time(shift.startedAt)}–{time(now)} · {duration(shift.startedAt, now)}</Text>
        <View style={{ flex: 1 }} />
        <Btn t={t} label="Κλείσιμο ημέρας" Icon={Lock} onPress={onDay} />
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 10 }}>
        <Income t={t} f={f} title="Εισπράξεις βάρδιας" flex={wide ? 1.3 : undefined} />
        <View style={{ flexDirection: "row", gap: 10, flex: wide ? 2 : undefined }}>
          <View style={[card(t), { flex: 1 }]}>
            <Label t={t} Icon={Receipt} text="Αποδείξεις" />
            <Text style={[ty(24, "s", t.text), num]}>{f.receipts}</Text>
            <Text style={[ty(12.5, "m", t.muted), num]}>{f.receipts ? `Μέση απόδειξη ${euro(Math.round(f.incomeCents / f.receipts))}` : "Καμία ακόμα"}</Text>
          </View>
          <View style={[card(t), { flex: 1 }]}>
            <Label t={t} Icon={Undo2} text="Επιστροφές" />
            <Text style={[ty(24, "s", f.refunds ? t.bad : t.text), num]}>{f.refunds}</Text>
            <Text style={[ty(12.5, "m", t.muted), num]}>{f.refunds ? `−${euro(f.refundCents)}${f.refundCashCents ? ` · ${euro(f.refundCashCents)} μετρητά` : ""}` : "Καμία επιστροφή"}</Text>
          </View>
        </View>
      </View>
      <Hours t={t} f={f} />
      <View style={card(t)}>
        <Text style={[ty(12.5, "m", t.muted), { marginBottom: 2 }]}>Πόσα πρέπει να έχει το συρτάρι</Text>
        <Line t={t} first k="Μετρητά έναρξης" v={euro(shift.openingCents)} />
        <Line t={t} k="+ Πωλήσεις μετρητοίς" v={euro(f.cashCents)} />
        <Line t={t} k="− Επιστροφές μετρητοίς" v={f.refundCashCents ? `−${euro(f.refundCashCents)}` : euro(0)} />
        <Line t={t} strong k="Αναμενόμενα" v={euro(report.expectedCents)} />
      </View>
    </View>
  );

  const denomLabel = (d: number) => (d >= 100 ? `${d / 100} €` : "0,50 €");
  const field = (value: string, onChange: (v: string) => void, label: string, bad: boolean, w = 64, pad: "number-pad" | "decimal-pad" = "number-pad") => (
    <TextInput value={value} onChangeText={onChange} keyboardType={pad} placeholder="0" placeholderTextColor={t.faint} accessibilityLabel={label} selectTextOnFocus
      style={[ty(15, "s", bad ? t.bad : t.text), num, { width: w, height: 36, borderRadius: 8, backgroundColor: t.card, textAlign: "center", paddingVertical: 0 }]} />
  );
  const cells = [...DENOMS.map((d) => ({ key: String(d), label: denomLabel(d), input: field(counts[d] ?? "", (v) => setCounts((c) => ({ ...c, [d]: v })), `Τεμάχια ${denomLabel(d)}`, !!counts[d] && !/^\d{1,5}$/.test(counts[d].trim())), cents: /^\d{1,5}$/.test((counts[d] ?? "").trim()) ? Number(counts[d]) * d : 0 })),
    { key: "loose", label: "Ψιλά", input: field(loose, setLoose, "Ψιλά σε ευρώ", parseEuro(loose) == null, 64, "decimal-pad"), cents: parseEuro(loose) ?? 0 }];
  const half = Math.ceil(cells.length / 2);
  const column = (list: typeof cells) => (
    <View style={{ flex: 1 }}>
      {list.map((c) => (
        <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 46, borderBottomWidth: 1, borderBottomColor: t.divider }}>
          <Text style={[ty(13.5, "s", t.text), num, { width: 52 }]}>{c.label}</Text>
          {c.input}
          <Text style={[ty(13, "m", t.muted), num, { flex: 1, textAlign: "right" }]}>{euroText(c.cents)}</Text>
        </View>
      ))}
    </View>
  );

  const right = (
    <View style={{ gap: 12, width: wide ? 440 : undefined, backgroundColor: t.panel, borderRadius: wide ? 0 : 14, padding: wide ? 22 : 16, borderLeftWidth: wide ? 1 : 0, borderLeftColor: t.divider }}>
      <View style={{ gap: 4 }}>
        <Text style={ty(15, "s", t.text)}>Μέτρησε το συρτάρι</Text>
        <Text style={ty(12.5, "m", t.muted)}>Γράψε πόσα τεμάχια έχεις από το καθένα· το σύνολο βγαίνει μόνο του.</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 18 }}>{column(cells.slice(0, half))}{column(cells.slice(half))}</View>
      <Line t={t} first strong k="Μέτρησες" v={counted == null ? "—" : euro(counted)} />
      {touched ? (
        counted == null ? <Text style={ty(13, "s", t.bad)}>Έλεγξε τα ποσά: μόνο αριθμοί</Text> : (
          <View style={{ borderRadius: 14, padding: 12, flexDirection: "row", gap: 10, backgroundColor: tint(toneColor(t, tone)) }} accessibilityLiveRegion="polite">
            {tone === "ok" ? <CircleCheck size={18} strokeWidth={1.75} color={t.ok} /> : <TriangleAlert size={18} strokeWidth={1.75} color={toneColor(t, tone)} />}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[ty(15, "s", toneColor(t, tone)), num]}>{diff === 0 ? "Το συρτάρι συμφωνεί" : diffText(diff)}</Text>
              <Text style={[ty(12.5, "m", t.muted), { lineHeight: 17 }]}>{diff === 0 ? "Μπορείς να κλείσεις τη βάρδια." : "Γράψε τι έγινε. Ο υπεύθυνος το βλέπει στην κονσόλα."}</Text>
            </View>
          </View>
        )
      ) : null}
      {touched && counted != null && diff !== 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {REASONS.map((r) => (
              <Pressable key={r} onPress={() => setReason(r)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center", backgroundColor: reason === r ? t.raised : t.card }}>
                <Text style={ty(13, "s", reason === r ? t.text : t.muted)}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={reason} onChangeText={setReason} placeholder="Τι έγινε;" placeholderTextColor={t.faint} maxLength={200} accessibilityLabel="Αιτία διαφοράς"
            style={[ty(14, "m", t.text), { minHeight: 44, borderRadius: 10, backgroundColor: t.card, paddingHorizontal: 12 }]} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, backgroundColor: t.card, borderRadius: 12, padding: 12, gap: 4 }}>
          <Text style={ty(12, "m", t.muted)}>Αφήνω για την επόμενη βάρδια</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <TextInput value={keptText} onChangeText={setKept} keyboardType="decimal-pad" selectTextOnFocus accessibilityLabel="Μετρητά που μένουν στο συρτάρι"
              style={[ty(17, "s", keptBad ? t.bad : t.text), num, { flex: 1, paddingVertical: 0 }]} />
            <Text style={ty(17, "s", t.muted)}>€</Text>
          </View>
        </View>
        <View style={{ flex: 1, backgroundColor: t.card, borderRadius: 12, padding: 12, gap: 4 }}>
          <Text style={ty(12, "m", t.muted)}>Βγαίνουν για κατάθεση</Text>
          <Text style={[ty(17, "s", t.text), num]}>{counted != null && keptCents != null && !keptBad ? euro(counted - keptCents) : "—"}</Text>
        </View>
      </View>
      {keptBad && counted != null ? <Text style={ty(12.5, "s", t.bad)}>Δεν μπορείς να αφήσεις περισσότερα από όσα μέτρησες</Text> : null}
      {sendError ? <Text style={ty(13, "s", t.bad)}>{sendError}</Text> : null}
      <Btn t={t} primary label={busy ? "Περίμενε…" : "Κλείσιμο βάρδιας"} Icon={Check} disabled={!ready || busy} onPress={submit} />
      {!touched ? <Text style={[ty(12, "m", t.faint), { textAlign: "center" }]}>Μέτρησε πρώτα το συρτάρι</Text> : null}
    </View>
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={wide ? { flexDirection: "row", minHeight: "100%" } : { padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {wide ? <View style={{ flex: 1, padding: 20, paddingLeft: 24 }}>{left}</View> : left}
      {right}
    </ScrollView>
  );
}

// ---- Κλείσιμο ημέρας ----

function weekdayPhrase(day: string) {
  const w = new Date(`${day}T12:00:00`).toLocaleDateString("el-GR", { weekday: "long" });
  return w === "Σάββατο" ? "το προηγούμενο Σάββατο" : `την προηγούμενη ${w}`;
}

export function DayCloseView({ t, session, width, onBack, onClosed, onUnpaired }: { t: Theme; session: Session; width: number; onBack: () => void; onClosed: () => void; onUnpaired: () => void }) {
  const wide = width >= 900;
  const [day] = useState(() => isoDay(new Date()));
  const [r, setR] = useState<DayReport>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const load = useCallback(() => { getDayReport(session, day).then(setR, (e) => (unpaired(e) ? onUnpaired() : setError(fail(e)))); }, [session, day, onUnpaired]);
  useEffect(load, [load]);
  if (error) return <Problem t={t} text={error} onRetry={() => { setError(undefined); load(); }} />;
  if (!r) return <Loading t={t} />;

  const change = r.prevIncomeCents ? Math.round(((r.figures.incomeCents - r.prevIncomeCents) / r.prevIncomeCents) * 100) : null;
  const withDiff = r.rows.filter((x) => x.countedCents != null && x.countedCents !== x.expectedCents).length;
  const dayTone = diffTone(r.diffCents);
  const submit = () => {
    setBusy(true); setSendError(undefined);
    closeDay(session, day).then(() => { load(); onClosed(); }, (e) => (unpaired(e) ? onUnpaired() : setSendError(fail(e)))).finally(() => setBusy(false));
  };
  const chip = (x: DayReport["rows"][number]) => {
    if (x.open) return { color: t.wait, text: "Ανοιχτή" };
    const d = (x.countedCents ?? x.expectedCents) - x.expectedCents;
    return { color: toneColor(t, diffTone(d)), text: d === 0 ? "Σωστό" : `${d > 0 ? "+" : "−"}${euro(Math.abs(d))}` };
  };
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: wide ? 24 : 16, paddingTop: 20, gap: 14, minHeight: "100%" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Text style={ty(20, "s", t.text)}>Κλείσιμο ημέρας</Text>
        <Text style={ty(13.5, "m", t.muted)}>{label}</Text>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 10 }}>
        <View style={[card(t), { flex: wide ? 1 : undefined }]}>
          <Label t={t} Icon={TrendingUp} text="Εισπράξεις ημέρας" />
          <Text style={[ty(24, "s", t.text), num]}>{euro(r.figures.incomeCents)}</Text>
          <Text style={[ty(12.5, "m", change == null ? t.muted : change >= 0 ? t.ok : t.wait), num]}>
            {change == null ? `Χωρίς κινήσεις ${weekdayPhrase(day)} για σύγκριση` : `${change >= 0 ? "+" : "−"}${Math.abs(change)}% σε σχέση με ${weekdayPhrase(day)}`}
          </Text>
        </View>
        <View style={[card(t), { flex: wide ? 1 : undefined }]}>
          <Label t={t} Icon={Banknote} text="Μετρητά για κατάθεση" />
          <Text style={[ty(24, "s", t.text), num]}>{euro(r.depositCents)}</Text>
          <Text style={[ty(12.5, "m", t.muted), num]}>{euro(r.keptCents)} μένουν στο συρτάρι για αύριο</Text>
        </View>
        <View style={[card(t), { flex: wide ? 1 : undefined }]}>
          <Label t={t} Icon={Scale} text="Διαφορά μετρητών" />
          <Text style={[ty(24, "s", toneColor(t, dayTone)), num]}>{r.diffCents === 0 ? euro(0) : `${r.diffCents > 0 ? "+" : "−"}${euro(Math.abs(r.diffCents))}`}</Text>
          <Text style={ty(12.5, "m", t.muted)}>{withDiff ? `${withDiff} ${withDiff === 1 ? "βάρδια" : "βάρδιες"} με διαφορά${dayTone === "wait" ? " · μέσα στο όριο" : dayTone === "bad" ? " · πάνω από το όριο" : ""}` : "Όλες οι βάρδιες συμφωνούν"}</Text>
        </View>
      </View>

      <View style={[card(t), { paddingVertical: 6, gap: 0 }]}>
        {wide ? (
          <View style={{ flexDirection: "row", paddingVertical: 8, gap: 12 }}>
            {[["Ταμίας", 2.2], ["Αποδείξεις", 1], ["Κάρτα / μετρητά", 1.6], ["Εισπράξεις", 1.2], ["Αναμενόμενα", 1.2], ["Μέτρησε", 1.2], ["Διαφορά", 1.2]].map(([h, fl], i) => (
              <Text key={h as string} style={[ty(12.5, "m", t.muted), { flex: fl as number, textAlign: i === 0 ? "left" : "right" }]}>{h}</Text>
            ))}
          </View>
        ) : null}
        {r.rows.length === 0 ? <Text style={[ty(13.5, "m", t.muted), { paddingVertical: 14 }]}>Δεν άνοιξε καμία βάρδια σήμερα σε αυτό το ταμείο.</Text> : null}
        {r.rows.map((x, i) => {
          const c = chip(x);
          const who = (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: wide ? 2.2 : 1 }}>
              <Avatar t={t} name={x.name} size={32} />
              <View><Text style={ty(13.5, "s", t.text)}>{x.name}</Text><Text style={[ty(12, "m", t.muted), num]}>{time(x.startedAt)}–{x.endedAt ? time(x.endedAt) : "τώρα"}</Text></View>
            </View>
          );
          const badge = <View style={{ alignSelf: wide ? "flex-end" : "auto", paddingHorizontal: 10, height: 26, borderRadius: 8, justifyContent: "center", backgroundColor: tint(c.color) }}><Text style={[ty(12, "s", c.color), num]}>{c.text}</Text></View>;
          if (!wide) return (
            <View key={x.id} style={{ paddingVertical: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.divider }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{who}{badge}</View>
              <SplitBar t={t} card={x.cardCents} cash={x.cashCents} />
              <Text style={[ty(12.5, "m", t.muted), num]}>{x.receipts} αποδείξεις · {euro(x.incomeCents)} · αναμενόμενα {euro(x.expectedCents)}{x.countedCents != null ? ` · μέτρησε ${euro(x.countedCents)}` : ""}</Text>
              {x.reason ? <Text style={ty(12.5, "m", t.faint)}>«{x.reason}»</Text> : null}
            </View>
          );
          return (
            <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.divider }}>
              {who}
              <Text style={[ty(13.5, "m", t.text), num, { flex: 1, textAlign: "right" }]}>{x.receipts}</Text>
              <View style={{ flex: 1.6, alignItems: "flex-end" }}><View style={{ width: 120 }}><SplitBar t={t} card={x.cardCents} cash={x.cashCents} /></View></View>
              <Text style={[ty(13.5, "m", t.text), num, { flex: 1.2, textAlign: "right" }]}>{euro(x.incomeCents)}</Text>
              <Text style={[ty(13.5, "m", t.text), num, { flex: 1.2, textAlign: "right" }]}>{euro(x.expectedCents)}</Text>
              <Text style={[ty(13.5, "m", t.text), num, { flex: 1.2, textAlign: "right" }]}>{x.countedCents != null ? euro(x.countedCents) : "—"}</Text>
              <View style={{ flex: 1.2 }}>{badge}</View>
            </View>
          );
        })}
        {wide && r.rows.length > 1 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.divider }}>
            <Text style={[ty(14, "s", t.text), { flex: 2.2 }]}>Σύνολο</Text>
            <Text style={[ty(14, "s", t.text), num, { flex: 1, textAlign: "right" }]}>{r.figures.receipts}</Text>
            <View style={{ flex: 1.6, alignItems: "flex-end" }}><View style={{ width: 120 }}><SplitBar t={t} card={r.figures.cardCents} cash={r.figures.cashCents} /></View></View>
            <Text style={[ty(14, "s", t.text), num, { flex: 1.2, textAlign: "right" }]}>{euro(r.figures.incomeCents)}</Text>
            <Text style={[ty(14, "s", t.text), num, { flex: 1.2, textAlign: "right" }]}>{euro(r.rows.reduce((n, x) => n + x.expectedCents, 0))}</Text>
            <Text style={[ty(14, "s", t.text), num, { flex: 1.2, textAlign: "right" }]}>{euro(r.countedCents)}</Text>
            <Text style={[ty(14, "s", toneColor(t, dayTone)), num, { flex: 1.2, textAlign: "right" }]}>{r.diffCents === 0 ? "Σωστό" : `${r.diffCents > 0 ? "+" : "−"}${euro(Math.abs(r.diffCents))}`}</Text>
          </View>
        ) : null}
      </View>

      {r.closed ? (
        <View style={[card(t), { flexDirection: "row", alignItems: "center", gap: 10 }]}><Lock size={18} strokeWidth={1.75} color={t.ok} /><Text style={ty(13.5, "m", t.text)}>Η ημέρα έκλεισε στις {time(r.closed.closedAt)} από {r.closed.closedBy}</Text></View>
      ) : r.blockers.length ? (
        <View style={[card(t), { backgroundColor: tint(t.wait), gap: 8 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><TriangleAlert size={18} strokeWidth={1.75} color={t.wait} /><Text style={ty(14, "s", t.wait)}>Πριν κλείσει η ημέρα</Text></View>
          {r.blockers.map((b) => <Text key={b} style={[ty(13.5, "m", t.text), { paddingLeft: 26 }]}>· {b}</Text>)}
        </View>
      ) : (
        <View style={[card(t), { flexDirection: "row", alignItems: "center", gap: 10 }]}><CircleCheck size={18} strokeWidth={1.75} color={t.ok} /><Text style={[ty(13.5, "m", t.muted), { flex: 1 }]}>Όλα είναι κλειστά: καμία βάρδια ανοιχτή, κανένα ανοιχτό τραπέζι, καμία χρέωση σε αναμονή στο POS.</Text></View>
      )}
      {sendError ? <Text style={ty(13, "s", t.bad)}>{sendError}</Text> : null}
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", gap: 12, justifyContent: "flex-end" }}>
        <Btn t={t} label="Πίσω" Icon={ArrowLeft} onPress={onBack} />
        {!r.closed ? <Btn t={t} primary label={busy ? "Περίμενε…" : "Κλείσιμο ημέρας"} Icon={Lock} disabled={busy || r.blockers.length > 0} onPress={submit} /> : null}
      </View>
    </ScrollView>
  );
}

/** Κάτω μέρος του μενού: ποιος είναι στη βάρδια. */
export function WhoIsOn({ t, name, since, onSwitch, compact }: { t: Theme; name: string; since: string; onSwitch: () => void; compact?: boolean }) {
  if (compact) return (
    <Pressable onPress={onSwitch} accessibilityRole="button" accessibilityLabel={`Βάρδια: ${name}. Αλλαγή βάρδιας`} style={{ alignItems: "center", paddingVertical: 6 }}>
      <Avatar t={t} name={name} size={36} />
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Avatar t={t} name={name} size={36} />
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={ty(13, "s", t.text)}>{name}</Text><Text style={[ty(12, "m", t.muted), num]}>Βάρδια από {time(since)}</Text></View>
      </View>
      <Pressable onPress={onSwitch} accessibilityRole="button" style={({ pressed }) => ({ height: 40, borderRadius: 12, borderWidth: 1, borderColor: t.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: pressed ? t.raised : t.card })}>
        <Wallet size={16} strokeWidth={1.75} color={t.text} /><Text style={ty(12.5, "s", t.text)}>Αλλαγή βάρδιας</Text>
      </Pressable>
    </View>
  );
}
