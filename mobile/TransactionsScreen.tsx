// Συναλλαγές του ταμείου. Ύφος: docs/mockups/central-till/transactions.html (καρέ 1 λίστα + λεπτομέρειες, 2 επιβεβαίωση,
// 3 αναμονή στο POS, κινητό με φύλλο από κάτω). Γαλάζιο = κάρτα, πράσινο-γκρι = μετρητά, κίτρινο = στο POS, γκρι = επιστροφή.
import { Banknote, Check, Circle, CircleCheck, CreditCard, Info, Loader, Receipt, RefreshCw, SmartphoneNfc, Undo2, Wallet, X, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";
import { ApiError, checkResult, reportResult, type Session } from "./api";
import { isoDay } from "./reservations";
import { euro, type Theme, tint, ty } from "./theme";
import { type Filter, hourly, matches, summary, type Tx } from "./transactions";
import { cancelRefund, type CreditState, creditState, getTransactions, refund } from "./transactions-api";

const num = { fontVariant: ["tabular-nums" as const] };
const ICON = { size: 18, strokeWidth: 1.75 };
const fail = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : e instanceof ApiError && e.status === 0 ? "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά." : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const unpaired = (e: unknown) => e instanceof ApiError && e.status === 401;
const time = (iso: string) => new Date(iso).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
const REASONS = ["Λάθος παραγγελία", "Παράπονο πελάτη", "Διπλή χρέωση", "Άλλο"];

/** Ετικέτα κατάστασης: χρώμα, εικονίδιο και λέξη (ποτέ μόνο χρώμα). */
function badge(t: Theme, r: Tx): { color: string; Icon: LucideIcon; text: string } {
  if (r.kind === "credit") return r.state === "refunding" ? { color: t.wait, Icon: Loader, text: "Στο POS" } : { color: t.muted, Icon: Undo2, text: "Επιστροφή" };
  if (r.state === "pos") return { color: t.wait, Icon: Loader, text: "Στο POS" };
  if (r.state === "refunding") return { color: t.wait, Icon: Loader, text: "Επιστρέφεται" };
  if (r.state === "refunded") return { color: t.muted, Icon: Undo2, text: "Επεστράφη" };
  return { color: t.ok, Icon: Check, text: r.kind === "share" ? "Εισπράχθηκε" : "Πληρώθηκε" };
}
function Badge({ t, r, small }: { t: Theme; r: Tx; small?: boolean }) {
  const b = badge(t, r);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: small ? 22 : 26, paddingHorizontal: small ? 8 : 10, borderRadius: 13, backgroundColor: tint(b.color) }}>
      <b.Icon size={13} strokeWidth={2} color={b.color} /><Text style={ty(12, "s", b.color)}>{b.text}</Text>
    </View>
  );
}

export function Btn({ t, label, onPress, primary, danger, solid, disabled, Icon, flex }: { t: Theme; label: string; onPress: () => void; primary?: boolean; danger?: boolean; solid?: boolean; disabled?: boolean; Icon?: LucideIcon; flex?: boolean }) {
  const c = primary ? t.onAction : solid ? t.ink : danger ? t.bad : t.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ flex: flex ? 1 : undefined, minHeight: 48, paddingHorizontal: 16, borderRadius: 12, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
        backgroundColor: primary ? t.action : solid ? t.bad : danger ? tint(t.bad) : pressed ? t.raised : "transparent", borderWidth: primary || solid ? 0 : 1, borderColor: danger ? `${t.bad}59` : t.line, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}>
      {Icon ? <Icon {...ICON} color={c} /> : null}
      <Text style={[ty(14, "s", c), num]}>{label}</Text>
    </Pressable>
  );
}

function Seg<T extends string>({ t, value, items, onChange }: { t: Theme; value: T; items: [T, string][]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: t.panel, borderRadius: 12, padding: 4, gap: 2 }}>
      {items.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="tab" accessibilityState={{ selected: v === value }} style={{ height: 40, paddingHorizontal: 12, borderRadius: 9, justifyContent: "center", backgroundColor: v === value ? t.raised : "transparent" }}>
          <Text style={ty(13.5, "s", v === value ? t.text : t.muted)}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---- Σύνοψη ημέρας και ωριαίο γράφημα ----

function Summary({ t, rows, now, wide, dayLabel }: { t: Theme; rows: Tx[]; now: Date; wide: boolean; dayLabel: string }) {
  const s = summary(rows);
  const h = hourly(rows, now);
  const cardC = t.categories[4], cashC = t.categories[2];
  const share = s.incomeCents ? s.cardCents / s.incomeCents : 0;
  const k = { backgroundColor: t.panel, borderRadius: 14, padding: 14, gap: 6 } as const;
  const lbl = (Icon: LucideIcon, text: string) => <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon size={15} strokeWidth={1.75} color={t.muted} /><Text style={ty(12.5, "m", t.muted)}>{text}</Text></View>;
  const income = (
    <View style={[k, { flex: wide ? 1.35 : undefined }]} accessibilityLabel={`Εισπράξεις ${dayLabel} ${euro(s.incomeCents)}, κάρτα ${euro(s.cardCents)}, μετρητά ${euro(s.cashCents)}`}>
      {lbl(Wallet, wide ? `Εισπράξεις ${dayLabel}` : `Εισπράξεις ${dayLabel} · ${s.receipts} αποδείξεις`)}
      <Text style={[ty(24, "s", t.text), num]}>{euro(s.incomeCents)}</Text>
      <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: s.cardCents && s.cashCents ? 2 : 0, backgroundColor: s.incomeCents ? "transparent" : t.raised }}>
        {s.cardCents ? <View style={{ flex: share, backgroundColor: cardC }} /> : null}
        {s.cashCents ? <View style={{ flex: 1 - share, backgroundColor: cashC }} /> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
        {[["Κάρτα", s.cardCents, cardC], ["Μετρητά", s.cashCents, cashC]].map(([name, c, color]) => (
          <View key={name as string} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color as string }} /><Text style={[ty(12.5, "m", t.muted), num]}>{name} {euro(c as number)}</Text></View>
        ))}
      </View>
      {!wide && s.refundCount ? <Text style={[ty(12.5, "m", t.bad), num]}>Επιστροφές {euro(s.refundCents)}</Text> : null}
    </View>
  );
  if (!wide) return income;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {income}
        <View style={[k, { flex: 1 }]}>
          {lbl(Receipt, "Αποδείξεις")}
          <Text style={[ty(24, "s", t.text), num]}>{s.receipts}</Text>
          <Text style={[ty(12.5, "m", t.muted), num]}>{s.receipts ? `Μέση απόδειξη ${euro(s.avgCents)}` : "Καμία ακόμα"}</Text>
        </View>
        <View style={[k, { flex: 1 }]}>
          {lbl(Undo2, "Επιστροφές")}
          <Text style={[ty(24, "s", s.refundCount ? t.bad : t.text), num]}>{s.refundCount ? euro(s.refundCents) : "0,00 €"}</Text>
          <Text style={[ty(12.5, "m", t.muted), num]}>{s.refundCount ? `${s.refundCount} ${s.refundCount === 1 ? "πιστωτικό" : "πιστωτικά"}` : "Καμία επιστροφή"}</Text>
        </View>
      </View>
      <View style={{ backgroundColor: t.panel, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }} accessibilityLabel={h.peak ? `Εισπράξεις ανά ώρα. Πιο πολλή κίνηση ${h.peak.hour}:00 με ${euro(h.peak.card + h.peak.cash)}` : "Εισπράξεις ανά ώρα: καμία ακόμα"}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={ty(12.5, "m", t.muted)}>Εισπράξεις ανά ώρα</Text>
          <Text style={[ty(12.5, "m", t.muted), num]}>{h.peak ? `πιο πολλή κίνηση ${h.peak.hour}:00–${h.peak.hour + 1}:00 · ${euro(h.peak.card + h.peak.cash)}` : "καμία ακόμα"}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6, height: 56, alignItems: "flex-end" }}>
          {h.bars.map((b) => (
            <View key={b.hour} style={{ flex: 1, height: "100%", justifyContent: "flex-end", gap: 2 }}>
              {b.cash ? <View style={{ height: `${(b.cash / h.max) * 100}%`, minHeight: 2, borderRadius: 3, backgroundColor: cashC }} /> : null}
              {b.card ? <View style={{ height: `${(b.card / h.max) * 100}%`, minHeight: 2, borderRadius: 3, backgroundColor: cardC }} /> : null}
              {!b.card && !b.cash ? <View style={{ height: 2, borderRadius: 1, backgroundColor: b.now ? t.muted : t.line }} /> : null}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
          {h.bars.map((b) => <Text key={b.hour} style={[ty(11.5, b.now ? "s" : "m", b.now ? t.text : t.faint), num, { flex: 1, textAlign: "center" }]}>{String(b.hour).padStart(2, "0")}</Text>)}
        </View>
      </View>
    </View>
  );
}

// ---- Γραμμή λίστας ----

function Row({ t, r, on, compact, last, onPress }: { t: Theme; r: Tx; on: boolean; compact: boolean; last: boolean; onPress: () => void }) {
  const Icon = r.kind === "credit" ? Undo2 : r.cash ? Banknote : CreditCard;
  const sub = r.kind === "credit" ? [r.note, r.card ?? r.method].filter(Boolean).join(" · ")
    : r.state === "pos" ? `Περιμένει στο POS από ${time(r.at)}`
    : [r.table ? `Τραπέζι ${r.table}` : null, r.lines.length ? r.lines.map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ""}${l.name}`).join(", ") : null, r.card ?? r.method, r.note].filter(Boolean).join(" · ");
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${r.label}, ${time(r.at)}, ${euro(r.cents)}, ${badge(t, r).text}`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: compact ? 64 : 60, paddingHorizontal: 14, backgroundColor: on ? t.raised : pressed ? t.card : "transparent", borderBottomWidth: last ? 0 : 1, borderBottomColor: t.divider })}>
      {compact ? null : <Text style={[ty(13.5, "m", t.muted), num, { width: 44 }]}>{time(r.at)}</Text>}
      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: r.kind === "credit" ? "transparent" : r.cash ? t.categories[2] : t.categories[4], borderWidth: r.kind === "credit" ? 1 : 0, borderStyle: "dashed", borderColor: t.divider }}>
        <Icon {...ICON} color={r.kind === "credit" ? t.muted : t.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={ty(14, "s", t.text)}>{r.label}</Text>
        <Text numberOfLines={1} style={[ty(12.5, "m", t.muted), num]}>{compact ? `${time(r.at)} · ${sub}` : sub}</Text>
      </View>
      {compact ? (
        <View style={{ alignItems: "flex-end", gap: 4 }}><Text style={[ty(15, "s", r.cents < 0 || r.state === "refunded" ? t.muted : t.text), num]}>{euro(r.cents)}</Text><Badge t={t} r={r} small /></View>
      ) : (
        <>
          <Text style={[ty(15.5, "s", r.cents < 0 || r.state === "refunded" ? t.muted : t.text), num, { minWidth: 80, textAlign: "right" }]}>{euro(r.cents)}</Text>
          <View style={{ width: 128, alignItems: "flex-end" }}><Badge t={t} r={r} /></View>
        </>
      )}
    </Pressable>
  );
}

// ---- Λεπτομέρειες (πλαίσιο δεξιά στο tablet, φύλλο από κάτω στο κινητό) ----

const box = (t: Theme) => ({ backgroundColor: t.card, borderRadius: 12, paddingHorizontal: 14 }) as const;
function Pair({ t, k, v, mono, first, strong }: { t: Theme; k: string; v: string; mono?: boolean; first?: boolean; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: t.divider }}>
      <Text style={ty(strong ? 15 : 13.5, strong ? "s" : "m", strong ? t.text : t.muted)}>{k}</Text>
      <Text numberOfLines={1} style={[ty(strong ? 15 : 13.5, "s", t.text), num, mono ? { letterSpacing: 0.3 } : null, { flexShrink: 1, textAlign: "right" }]}>{v}</Text>
    </View>
  );
}

function Detail({ t, r, busy, onRefund, onCancelCharge, onCheck, onCancelRefund }: { t: Theme; r: Tx; busy: boolean; onRefund: () => void; onCancelCharge: () => void; onCheck: () => void; onCancelRefund: () => void }) {
  const title = r.kind === "credit" ? `Πιστωτικό ${r.note ?? ""}`.trim() : r.kind === "share" ? "Μερίδιο λογαριασμού" : r.state === "pos" ? `Χρέωση ${r.label}` : `Απόδειξη ${r.label}`;
  const shown = r.lines.slice(0, 8); // χωρίς δεύτερη κύλιση δίπλα στη λίστα
  const hint = r.state === "pos" ? "Ο πελάτης δεν έχει πληρώσει ακόμα. Η ακύρωση σταματά το POS και δεν εκδίδεται απόδειξη."
    : r.refundable ? (r.cash ? `Η επιστροφή εκδίδει πιστωτικό στην ΑΑΔΕ. Δίνεις ${euro(r.cents)} από το συρτάρι.` : `Η επιστροφή εκδίδει πιστωτικό στην ΑΑΔΕ και στέλνει ${euro(r.cents)} πίσω στην ίδια κάρτα μέσω του POS. Γίνεται για όλη την απόδειξη.`)
    : r.kind === "sale" && r.state === "paid" && r.note ? "Πληρώθηκε σε πολλά μέρη: η επιστροφή γίνεται από την κονσόλα, ανά πληρωμή."
    : r.state === "refunding" ? "Η επιστροφή περιμένει στο POS να ακουμπήσει ο πελάτης την κάρτα." : null;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1 }}><Text accessibilityRole="header" style={ty(17, "s", t.text)}>{title}</Text><Text style={[ty(13.5, "m", t.muted), num, { marginTop: 2 }]}>{time(r.at)}{r.table ? ` · Τραπέζι ${r.table}` : ""}</Text></View>
        <Badge t={t} r={r} />
      </View>
      {shown.length ? (
        <View style={box(t)}>
          {shown.map((l, i) => <Pair key={i} t={t} first={i === 0} k={`${l.quantity} × ${l.name}`} v={euro(l.cents)} />)}
          {r.lines.length > shown.length ? <Text style={[ty(12.5, "m", t.faint), { paddingBottom: 8 }]}>και {r.lines.length - shown.length} ακόμα</Text> : null}
          <Pair t={t} k="Σύνολο" v={euro(r.cents)} strong />
        </View>
      ) : null}
      <View style={box(t)}>
        {!shown.length ? <Pair t={t} first k="Ποσό" v={euro(r.cents)} strong /> : null}
        <Pair t={t} first={!!shown.length} k="Πληρωμή" v={r.card ?? r.method} />
        {r.mark ? <Pair t={t} k="MARK ΑΑΔΕ" v={r.mark} mono /> : null}
      </View>
      {hint ? <View style={{ flexDirection: "row", gap: 8 }}><Info size={16} strokeWidth={1.75} color={t.muted} /><Text style={[ty(12.5, "m", t.muted), num, { flex: 1, lineHeight: 18 }]}>{hint}</Text></View> : null}
      <View style={{ gap: 8 }}>
        {r.state === "pos" ? <View style={{ flexDirection: "row", gap: 8 }}><Btn t={t} flex label="Έλεγχος" Icon={RefreshCw} onPress={onCheck} disabled={busy} /><Btn t={t} flex danger label="Ακύρωση χρέωσης" Icon={X} onPress={onCancelCharge} disabled={busy} /></View> : null}
        {r.creditId ? <View style={{ flexDirection: "row", gap: 8 }}><Btn t={t} flex label="Έλεγχος" Icon={RefreshCw} onPress={onCheck} disabled={busy} /><Btn t={t} flex danger label="Ακύρωση επιστροφής" Icon={X} onPress={onCancelRefund} disabled={busy} /></View> : null}
        {r.refundable ? <Btn t={t} danger label={`Επιστροφή ${euro(r.cents)}`} Icon={Undo2} onPress={onRefund} disabled={busy} /> : null}
      </View>
    </View>
  );
}

// ---- Επιστροφή: επιβεβαίωση και αναμονή στο POS ----

type Flow = { step: "confirm"; reason: string } | { step: "pos"; creditId: string; error?: string } | { step: "done"; ok: boolean; text: string };

function RefundDialog({ t, r, flow, busy, setFlow, onStart, onCancel, onCheck, onClose }: { t: Theme; r: Tx; flow: Flow; busy: boolean; setFlow: (f: Flow) => void; onStart: (reason: string) => void; onCancel: () => void; onCheck: () => void; onClose: () => void }) {
  const icon = (Icon: LucideIcon, color: string) => <View style={{ width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: tint(color) }}><Icon size={24} strokeWidth={1.75} color={color} /></View>;
  const step = (done: boolean, cur: boolean, text: string) => {
    const I = done ? CircleCheck : cur ? Loader : Circle;
    return <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><I {...ICON} color={done ? t.ok : cur ? t.wait : t.faint} /><Text style={ty(13.5, done || cur ? "s" : "m", done || cur ? t.text : t.muted)}>{text}</Text></View>;
  };
  const where = r.cash ? "από το συρτάρι" : `στην κάρτα ${r.card ?? ""}`.trim();
  return (
    <Modal transparent animationType="fade" onRequestClose={flow.step === "pos" ? () => {} : onClose} statusBarTranslucent>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.55)" }}>
        <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 460, backgroundColor: t.panel, borderRadius: 20, padding: 24, gap: 16 }}>
          {flow.step === "confirm" ? (
            <>
              {icon(Undo2, t.bad)}
              <Text accessibilityRole="header" style={[ty(20, "s", t.text), num]}>Επιστροφή {euro(r.cents)} {r.cash ? "σε μετρητά" : "στην κάρτα"};</Text>
              <Text style={[ty(13.5, "r", t.muted), num, { lineHeight: 20 }]}>Για την απόδειξη {r.label}. Θα εκδοθεί πιστωτικό στην ΑΑΔΕ{r.cash ? " και δίνεις τα χρήματα από το συρτάρι." : ` και το POS θα ζητήσει από τον πελάτη να ακουμπήσει την κάρτα ${r.card ?? ""}.`} Δεν αναιρείται μετά.</Text>
              <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.divider }}>
                <Text style={ty(12.5, "s", t.muted)}>Αιτία</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {REASONS.map((x) => (
                    <Pressable key={x} onPress={() => setFlow({ step: "confirm", reason: x })} accessibilityRole="radio" accessibilityState={{ selected: flow.reason === x }}
                      style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center", backgroundColor: flow.reason === x ? t.raised : t.card, borderWidth: 1, borderColor: flow.reason === x ? t.muted : "transparent" }}>
                      <Text style={ty(13.5, "s", flow.reason === x ? t.text : t.muted)}>{x}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}><Btn t={t} flex label="Πίσω" onPress={onClose} disabled={busy} /><Btn t={t} flex solid label={busy ? "Στέλνεται…" : "Επιστροφή"} Icon={Undo2} onPress={() => onStart(flow.reason)} disabled={busy || !flow.reason} /></View>
            </>
          ) : flow.step === "pos" ? (
            <>
              {icon(SmartphoneNfc, t.wait)}
              <Text accessibilityRole="header" style={ty(20, "s", t.text)}>Ακούμπησε την κάρτα στο POS</Text>
              <Text style={[ty(13.5, "r", t.muted), num, { lineHeight: 20 }]}>Επιστροφή {euro(r.cents)} {where}. Το POS δείχνει ήδη το ποσό.</Text>
              <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.divider }} accessibilityLiveRegion="polite">
                {step(true, false, "Το πιστωτικό ετοιμάστηκε")}
                {step(false, true, "Περιμένει την κάρτα στο POS")}
                {step(false, false, "Σφραγίζεται στην ΑΑΔΕ")}
              </View>
              {flow.error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>{flow.error}</Text> : null}
              <View style={{ flexDirection: "row", gap: 8 }}><Btn t={t} flex label="Ακύρωση" onPress={onCancel} disabled={busy} /><Btn t={t} flex label="Έλεγχος" Icon={RefreshCw} onPress={onCheck} disabled={busy} /></View>
            </>
          ) : (
            <>
              {icon(flow.ok ? CircleCheck : X, flow.ok ? t.ok : t.bad)}
              <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={ty(20, "s", t.text)}>{flow.ok ? "Η επιστροφή έγινε" : "Η επιστροφή δεν έγινε"}</Text>
              <Text style={[ty(13.5, "r", t.muted), num, { lineHeight: 20 }]}>{flow.text}</Text>
              <Btn t={t} primary label="Εντάξει" onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---- Οθόνη ----

export function TransactionsView({ t, session, now, width, onUnpaired }: { t: Theme; session: Session; now: Date; width: number; onUnpaired: () => void }) {
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Tx[]>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<Flow>();
  const [notice, setNotice] = useState<string>();
  const date = isoDay(now, day === "today" ? 0 : -1);
  const wide = width >= 900;

  const load = useCallback(() => getTransactions(session, date).then((r) => { setRows(r); setError(undefined); }, (e) => (unpaired(e) ? onUnpaired() : setError(fail(e)))), [session, date, onUnpaired]);
  useEffect(() => { void load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => matches(r, filter)), [rows, filter]);
  const counts = useMemo(() => Object.fromEntries((["all", "card", "cash", "refunds"] as Filter[]).map((f) => [f, (rows ?? []).filter((r) => matches(r, f)).length])), [rows]);
  const current = rows?.find((r) => r.id === selected) ?? (wide ? shown[0] : undefined);

  const settle = useCallback((s: CreditState, r: Tx) => {
    if (s === "pending") return false;
    setFlow({ step: "done", ok: s === "completed", text: s === "completed" ? `Εκδόθηκε πιστωτικό για την ${r.label}${r.cash ? `. Δώσε ${euro(r.cents)} από το συρτάρι.` : ` και ${euro(r.cents)} επέστρεψαν στην κάρτα.`}` : "Το POS δεν ολοκλήρωσε την επιστροφή και δεν εκδόθηκε πιστωτικό. Μπορείς να δοκιμάσεις ξανά." });
    void load();
    return true;
  }, [load]);

  // Όσο η επιστροφή περιμένει στο POS, ρωτάμε κάθε 3″ (όπως η πληρωμή)
  const waiting = flow?.step === "pos" ? flow.creditId : undefined;
  useEffect(() => {
    if (!waiting || !current) return;
    const id = setInterval(() => { creditState(session, waiting).then((s) => settle(s, current), () => {}); }, 3000);
    return () => clearInterval(id);
  }, [waiting, current, session, settle]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setNotice(undefined);
    try { await f(); } catch (e) { if (unpaired(e)) onUnpaired(); else if (flow?.step === "pos") setFlow({ ...flow, error: fail(e) }); else setNotice(fail(e)); } finally { setBusy(false); }
  };
  const r = current;
  const actions = r && {
    onRefund: () => setFlow({ step: "confirm", reason: "" }),
    onCheck: () => void run(async () => {
      if (r.creditId) { const s = await creditState(session, r.creditId); if (s === "pending") setNotice("Η επιστροφή περιμένει ακόμα στο POS"); else settle(s, r); return; }
      const o = await checkResult(session, r.id);
      setNotice(o.state === "paid" ? "Πληρώθηκε" : o.state === "failed" ? "Δεν πληρώθηκε: η χρέωση έκλεισε" : "Περιμένει ακόμα στο POS");
      void load();
    }),
    onCancelCharge: () => void run(async () => {
      const o = await reportResult(session, r.id, { success: false, callback: "" });
      setNotice(o.state === "paid" ? "Ο πελάτης είχε ήδη πληρώσει: η απόδειξη εκδόθηκε" : o.state === "unknown" ? "Η ακύρωση στάλθηκε στο POS. Πάτα «Έλεγχος» σε λίγο" : "Η χρέωση ακυρώθηκε. Δεν εκδόθηκε απόδειξη");
      void load();
    }),
    onCancelRefund: () => void run(async () => { const s = await cancelRefund(session, r.creditId!); if (s === "pending") setNotice("Η ακύρωση στάλθηκε στο POS. Πάτα «Έλεγχος» σε λίγο"); else settle(s, r); }),
  };
  const start = (reason: string) => r && void run(async () => {
    const res = await refund(session, r.id, reason);
    if (res.state === "pending") setFlow({ step: "pos", creditId: res.creditId }); else settle(res.state, r);
  });

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Text accessibilityRole="header" style={ty(20, "s", t.text)}>Συναλλαγές</Text>
      {wide ? <Text style={ty(13.5, "m", t.muted)}>{new Date(`${date}T12:00:00`).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" })}</Text> : null}
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Ανανέωση" style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.raised : t.panel })}><RefreshCw {...ICON} color={t.muted} /></Pressable>
      <Seg t={t} value={day} onChange={(d) => { setDay(d); setSelected(undefined); setRows(undefined); }} items={[["today", "Σήμερα"], ["yesterday", "Χθες"]]} />
    </View>
  );
  const chips = (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      {([["all", "Όλες", null], ["card", "Κάρτα", CreditCard], ["cash", "Μετρητά", Banknote], ["refunds", "Επιστροφές", Undo2]] as [Filter, string, LucideIcon | null][]).map(([f, label, Icon]) => (
        <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: f === filter }} style={{ height: 40, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: f === filter ? t.raised : t.panel }}>
          {Icon ? <Icon size={16} strokeWidth={1.75} color={f === filter ? t.text : t.muted} /> : null}
          <Text style={ty(13.5, "s", f === filter ? t.text : t.muted)}>{label}</Text>
          {wide ? <Text style={[ty(13, "m", t.faint), num]}>{counts[f]}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
  const empty = rows && !shown.length ? (
    <View style={{ padding: 24, alignItems: "center", gap: 6 }}>
      <Receipt size={24} strokeWidth={1.75} color={t.faint} />
      <Text style={ty(14, "s", t.text)}>{rows.length ? "Καμία συναλλαγή σε αυτό το φίλτρο" : day === "today" ? "Καμία συναλλαγή ακόμα σήμερα" : "Καμία συναλλαγή χθες"}</Text>
      <Text style={ty(13, "m", t.muted)}>{rows.length ? "Διάλεξε «Όλες» για να δεις τα υπόλοιπα." : "Οι αποδείξεις του ταμείου εμφανίζονται εδώ μόλις πληρωθούν."}</Text>
    </View>
  ) : null;
  const status = error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>{error}</Text> : notice ? <Text accessibilityLiveRegion="polite" style={ty(13, "m", t.wait)}>{notice}</Text> : null;
  const dayLabel = day === "today" ? "σήμερα" : "χθες";
  // «Ακύρωση»/«Έλεγχος» μέσα στο παράθυρο αφορούν το πιστωτικό που μόλις ξεκίνησε
  const onFlow = (cancel: boolean) => { if (flow?.step !== "pos" || !r) return; void run(async () => {
    const s = cancel ? await cancelRefund(session, flow.creditId) : await creditState(session, flow.creditId);
    if (s === "pending") setFlow({ ...flow, error: cancel ? "Η ακύρωση στάλθηκε στο POS. Πάτα «Έλεγχος» σε λίγο." : "Ακόμα στο POS. Ο πελάτης δεν έχει ακουμπήσει την κάρτα." });
    else settle(s, r);
  }); };
  const dialog = r && flow ? <RefundDialog t={t} r={r} flow={flow} busy={busy} setFlow={setFlow} onStart={start} onCancel={() => onFlow(true)} onCheck={() => onFlow(false)} onClose={() => setFlow(undefined)} /> : null;

  if (!rows && !error) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>;

  const list = (
    <FlatList
      data={shown}
      keyExtractor={(x) => `${x.kind}-${x.id}`}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 24 }}
      ListHeaderComponent={<View style={{ gap: 14 }}>{header}<Summary t={t} rows={rows ?? []} now={now} wide={wide} dayLabel={dayLabel} />{chips}{status}</View>}
      ListHeaderComponentStyle={{ marginBottom: 14 }}
      ListEmptyComponent={empty ?? undefined}
      renderItem={({ item, index }) => (
        <View style={{ backgroundColor: t.panel, borderTopLeftRadius: index === 0 ? 14 : 0, borderTopRightRadius: index === 0 ? 14 : 0, borderBottomLeftRadius: index === shown.length - 1 ? 14 : 0, borderBottomRightRadius: index === shown.length - 1 ? 14 : 0, overflow: "hidden" }}>
          <Row t={t} r={item} on={item.id === current?.id} compact={!wide} last={index === shown.length - 1} onPress={() => setSelected(item.id)} />
        </View>
      )}
    />
  );

  if (wide) return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {list}
      <View style={{ width: 380, backgroundColor: t.panel, borderLeftWidth: 1, borderLeftColor: t.divider, padding: 20 }}>
        {r && actions ? <Detail t={t} r={r} busy={busy} {...actions} /> : <Text style={ty(13.5, "m", t.muted)}>Διάλεξε μια συναλλαγή για να δεις τι περιλαμβάνει.</Text>}
      </View>
      {dialog}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      {list}
      {r && actions && selected && !flow ? (
        <Modal transparent animationType="slide" onRequestClose={() => setSelected(undefined)} statusBarTranslucent>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setSelected(undefined)} accessibilityLabel="Κλείσιμο" />
          <View style={{ backgroundColor: t.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 12 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.divider, alignSelf: "center" }} />
            <Detail t={t} r={r} busy={busy} {...actions} />
          </View>
        </Modal>
      ) : null}
      {dialog}
    </View>
  );
}
