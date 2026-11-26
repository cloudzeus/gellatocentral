// Παραγγελίες εκτός καταστήματος και καρτέλα κλήσης στο ταμείο. Ύφος: docs/mockups/central-till/orders-callerid.html
// (1 καρτέλα γνωστού, 2 άγνωστος αριθμός, 3 αποστολή τηλεφωνικής, 4 αποδοχή πλατφόρμας, 5 λίστα και πορεία).
import { Bike, Check, Clock, MapPin, Phone, PhoneIncoming, Plus, RotateCcw, ShoppingBag, StickyNote, TriangleAlert, Wallet, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError, type SaleLine, type Session } from "./api";
import { createCustomer, createPhoneOrder, findCustomer, getLiveCall, getOrders, moveOrder, seeCall } from "./orders-api";
import { type Customer, km, nextMove, type Order, type OrderDraft, type OrderLine, PAYMENT, readyText, SOURCE, STATUS, steps } from "./orders";
import { Chip, field, label, Sheet } from "./ReservationsScreen";
import { euro, type Theme, tint, ty } from "./theme";

const num = { fontVariant: ["tabular-nums" as const] };
const ICON = { size: 18, strokeWidth: 1.75 };
const fail = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : e instanceof ApiError && e.status === 0 ? "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά." : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const unpairedBy = (e: unknown) => e instanceof ApiError && e.status === 401;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
const phoneText = (d: string) => (d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d);
const statusColor = (t: Theme, o: Order) => (o.status === "NEW" ? t.wait : o.status === "REJECTED" || o.status === "CANCELLED" ? t.bad : o.status === "DELIVERED" ? t.faint : t.ok);

function Big({ t, label: text, onPress, disabled, tone = "action", Icon }: { t: Theme; label: string; onPress: () => void; disabled?: boolean; tone?: "action" | "quiet" | "bad"; Icon?: typeof Check }) {
  const bg = tone === "action" ? t.action : tone === "bad" ? tint(t.bad) : t.card;
  const fg = tone === "action" ? t.onAction : tone === "bad" ? t.bad : t.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ minHeight: 52, borderRadius: 26, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: bg, opacity: disabled ? 0.35 : pressed ? 0.85 : 1 })}>
      {Icon ? <Icon {...ICON} color={fg} /> : null}<Text style={ty(15, "s", fg)}>{text}</Text>
    </Pressable>
  );
}

const Badge = ({ t, text, color }: { t: Theme; text: string; color: string }) => (
  <View style={{ paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: tint(color), justifyContent: "center" }}><Text style={ty(12, "s", color)}>{text}</Text></View>
);

const linesText = (lines: OrderLine[]) => lines.map((l) => `${l.quantity}× ${l.name}${l.options.length ? ` (${l.options.map((o) => o.name).join(", ")})` : ""}`).join(" · ");

// ---- 5 · Λίστα παραγγελιών και πορεία ----

export function OrdersView({ t, session, now, width, onOpenBill, onNewOrder, onUnpaired }: {
  t: Theme; session: Session; now: Date; width: number; onOpenBill: (id: string) => void; onNewOrder: (c: Customer | null, phone: string) => void; onUnpaired: () => void;
}) {
  const [data, setData] = useState<{ orders: Order[]; missedCalls: number }>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [accepting, setAccepting] = useState<Order>();
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState(false);

  const load = useCallback(() => getOrders(session).then((d) => { setData(d); setError(undefined); }, (e) => (unpairedBy(e) ? onUnpaired() : setError(fail(e)))), [session, onUnpaired]);
  useEffect(() => { void load(); const id = setInterval(load, 10_000); return () => clearInterval(id); }, [load]);

  const move = async (o: Order, to: Order["status"], extra?: { readyInMin?: number; reason?: string }) => {
    setBusy(true);
    try { await moveOrder(session, o.id, to, extra); setAccepting(undefined); await load(); }
    catch (e) { if (unpairedBy(e)) onUnpaired(); else setError(fail(e)); }
    finally { setBusy(false); }
  };

  if (!data) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>{error ? <Text style={ty(14, "m", t.bad)}>{error}</Text> : <ActivityIndicator color={t.muted} />}</View>;
  const open = data.orders.filter((o) => ["NEW", "ACCEPTED", "READY", "OUT"].includes(o.status));
  const closed = data.orders.filter((o) => !open.includes(o));
  const order = data.orders.find((o) => o.id === selected) ?? open[0];
  const listW = Math.min(400, Math.round(width * 0.42));
  const group = (title: string, rows: Order[]) => rows.length ? (
    <View key={title} style={{ gap: 6 }}>
      <Text style={[ty(12.5, "s", t.muted), { paddingTop: 8 }]}>{title} · {rows.length}</Text>
      {rows.map((o) => {
        const on = o.id === order?.id;
        const r = readyText(o.readyAt, now);
        return (
          <Pressable key={o.id} onPress={() => setSelected(o.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ backgroundColor: on ? t.raised : t.card, borderRadius: 12, padding: 12, gap: 4, borderLeftWidth: 4, borderLeftColor: statusColor(t, o) }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {o.delivery ? <Bike size={16} strokeWidth={1.75} color={t.muted} /> : <ShoppingBag size={16} strokeWidth={1.75} color={t.muted} />}
              <Text numberOfLines={1} style={[ty(14, "s", t.text), { flex: 1 }]}>{o.name}</Text>
              <Text style={[ty(14, "s", t.text), num]}>{euro(o.totalCents)}</Text>
            </View>
            <Text numberOfLines={1} style={[ty(12.5, "m", t.muted), num]}>{SOURCE[o.source]} · {hhmm(o.createdAt)}{r && open.includes(o) ? ` · έτοιμη ${r.text}` : ""}{o.status === "NEW" ? " · περιμένει αποδοχή" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: listW, borderRightWidth: 1, borderRightColor: t.divider }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
          <Text accessibilityRole="header" style={[ty(20, "s", t.text), { flex: 1 }]}>Παραγγελίες</Text>
          <Pressable onPress={() => setLookup(true)} accessibilityRole="button" accessibilityLabel="Νέα τηλεφωνική παραγγελία" style={({ pressed }) => ({ height: 44, paddingHorizontal: 14, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: pressed ? t.raised : t.card })}>
            <Plus {...ICON} color={t.text} /><Text style={ty(13.5, "s", t.text)}>Τηλεφωνική</Text>
          </Pressable>
        </View>
        {data.missedCalls ? <View style={{ marginHorizontal: 16, flexDirection: "row", gap: 6, alignItems: "center" }}><PhoneIncoming size={14} strokeWidth={2} color={t.wait} /><Text style={ty(12.5, "m", t.wait)}>{data.missedCalls} αναπάντητες κλήσεις σήμερα</Text></View> : null}
        {error ? <Text style={[ty(12.5, "m", t.bad), { marginHorizontal: 16 }]}>{error}</Text> : null}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 4 }}>
          {!data.orders.length ? <Text style={[ty(13.5, "m", t.muted), { paddingVertical: 12, lineHeight: 20 }]}>Καμία παραγγελία ακόμα. Οι τηλεφωνικές μπαίνουν από την καρτέλα της κλήσης ή από το «Τηλεφωνική».</Text> : null}
          {group("Νέες", open.filter((o) => o.status === "NEW"))}
          {group("Σε ετοιμασία", open.filter((o) => o.status === "ACCEPTED"))}
          {group("Έτοιμες", open.filter((o) => o.status === "READY"))}
          {group("Στον δρόμο", open.filter((o) => o.status === "OUT"))}
          {group("Κλειστές", closed)}
        </ScrollView>
      </View>
      {order ? <OrderDetail t={t} order={order} now={now} busy={busy} onMove={(to, extra) => void move(order, to, extra)} onAccept={() => setAccepting(order)} onOpenBill={onOpenBill} /> : <View style={{ flex: 1 }} />}
      {accepting ? <AcceptSheet t={t} order={accepting} busy={busy} onClose={() => setAccepting(undefined)} onAccept={(m) => void move(accepting, "ACCEPTED", { readyInMin: m })} onReject={(reason) => void move(accepting, "REJECTED", { reason })} /> : null}
      {lookup ? <PhoneLookup t={t} session={session} onClose={() => setLookup(false)} onFound={(c, phone) => { setLookup(false); onNewOrder(c, phone); }} /> : null}
    </View>
  );
}

function OrderDetail({ t, order: o, now, busy, onMove, onAccept, onOpenBill }: {
  t: Theme; order: Order; now: Date; busy: boolean; onMove: (to: Order["status"], extra?: { reason?: string }) => void; onAccept: () => void; onOpenBill: (id: string) => void;
}) {
  const [cancel, setCancel] = useState(false);
  const flow = steps(o.delivery);
  const at = flow.indexOf(o.status);
  const next = nextMove(o);
  const r = readyText(o.readyAt, now);
  const closed = o.status === "DELIVERED" || o.status === "REJECTED" || o.status === "CANCELLED";
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text accessibilityRole="header" style={[ty(22, "s", t.text), { flex: 1 }]}>{o.name}</Text>
        <Badge t={t} text={SOURCE[o.source]} color={t.muted} />
        <Badge t={t} text={STATUS[o.status]} color={statusColor(t, o)} />
      </View>
      {/* πορεία: τα βήματα με τη σειρά, το τρέχον φωτεινό */}
      {at >= 0 ? (
        <View style={{ flexDirection: "row", gap: 6 }} accessibilityLabel={`Πορεία: ${STATUS[o.status]}`}>
          {flow.map((s, i) => (
            <View key={s} style={{ flex: 1, gap: 6 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: i <= at ? t.ok : t.raised }} />
              <Text style={ty(12, i === at ? "s" : "m", i === at ? t.text : t.faint)}>{STATUS[s]}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
        <Fact t={t} Icon={o.delivery ? Bike : ShoppingBag} text={o.delivery ? "Διανομή" : "Παραλαβή"} />
        {r && !closed ? <Fact t={t} Icon={Clock} text={`Έτοιμη ${hhmm(o.readyAt!)} · ${r.text}`} color={r.late ? t.wait : undefined} /> : null}
        {o.phone ? <Fact t={t} Icon={Phone} text={o.phone} /> : null}
        <Fact t={t} Icon={o.paid ? Check : Wallet} text={`${PAYMENT[o.payment]}${o.payment === "PLATFORM" ? "" : o.paid ? " · πληρώθηκε" : " · δεν πληρώθηκε"}`} color={o.paid ? t.ok : undefined} />
      </View>
      {o.address ? <Fact t={t} Icon={MapPin} text={o.address} /> : null}
      {o.note ? <Fact t={t} Icon={StickyNote} text={o.note} /> : null}
      {o.rejectReason ? <Fact t={t} Icon={TriangleAlert} text={`Λόγος: ${o.rejectReason}`} color={t.bad} /> : null}
      <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 14, gap: 8 }}>
        {o.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 10 }}>
            <Text style={[ty(14, "s", t.text), num, { width: 28 }]}>{l.quantity}×</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ty(14, "s", l.productId ? t.text : t.wait)}>{l.name}{l.productId ? "" : " · δεν υπάρχει στον κατάλογο"}</Text>
              {l.options.length ? <Text style={ty(12.5, "m", t.muted)}>{l.options.map((x) => x.name).join(", ")}</Text> : null}
              {l.note ? <Text style={ty(12.5, "m", t.muted)}>Σημείωση: {l.note}</Text> : null}
            </View>
            <Text style={[ty(14, "s", t.text), num]}>{euro(l.unitPriceCents * l.quantity)}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 8 }}>
          <Text style={ty(15, "s", t.text)}>Σύνολο</Text><Text style={[ty(18, "b", t.text), num]}>{euro(o.totalCents)}</Text>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        {o.status === "NEW" ? <Big t={t} label="Αποδοχή ή απόρριψη" onPress={onAccept} disabled={busy} Icon={Check} /> : null}
        {next ? <Big t={t} label={busy ? "Περίμενε…" : next.label} onPress={() => onMove(next.to)} disabled={busy} /> : null}
        {o.billId && !o.paid && !closed ? <Big t={t} tone="quiet" label="Πληρωμή και απόδειξη" onPress={() => onOpenBill(o.billId!)} disabled={busy} /> : null}
        {!closed && o.status !== "NEW" ? (cancel
          ? <View style={{ gap: 8 }}><Text style={label(t)}>Γιατί ακυρώνεται;</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["Ο πελάτης την ακύρωσε", "Δεν υπάρχει είδος", "Λάθος παραγγελία"].map((x) => <Chip key={x} t={t} label={x} onPress={() => onMove("CANCELLED", { reason: x })} />)}<Chip t={t} label="Πίσω" onPress={() => setCancel(false)} /></View></View>
          : <Big t={t} tone="bad" label="Ακύρωση παραγγελίας" onPress={() => setCancel(true)} disabled={busy} />) : null}
      </View>
    </ScrollView>
  );
}

const Fact = ({ t, Icon, text, color }: { t: Theme; Icon: typeof Check; text: string; color?: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon size={16} strokeWidth={1.75} color={color ?? t.muted} /><Text style={[ty(13.5, "m", color ?? t.text), num, { flexShrink: 1 }]}>{text}</Text></View>
);

// ---- 4 · Αποδοχή παραγγελίας πλατφόρμας ----

function AcceptSheet({ t, order, busy, onClose, onAccept, onReject }: { t: Theme; order: Order; busy: boolean; onClose: () => void; onAccept: (min: number) => void; onReject: (reason: string) => void }) {
  const [min, setMin] = useState(20);
  const [rejecting, setRejecting] = useState(false);
  const unknown = order.lines.filter((l) => !l.productId);
  const [opened] = useState(() => Date.now()); // η ώρα που άνοιξε η φόρμα: αρκεί για «έτοιμη στις»
  const at = new Date(opened + min * 60_000).toISOString();
  return (
    <Sheet t={t} title={`${SOURCE[order.source]} · ${order.name}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 14 }}>
        <Text style={[ty(13.5, "m", t.muted), num]}>{linesText(order.lines)} · {euro(order.totalCents)} · {PAYMENT[order.payment]}</Text>
        {unknown.length ? (
          <View style={{ flexDirection: "row", gap: 8, backgroundColor: tint(t.wait), borderRadius: 12, padding: 12 }}>
            <TriangleAlert size={16} strokeWidth={2} color={t.wait} />
            <Text style={[ty(13, "m", t.wait), { flex: 1 }]}>{unknown.map((l) => l.name).join(", ")}: δεν υπάρχει στον κατάλογο μας. Δες ότι το έχεις πριν την αποδεχτείς.</Text>
          </View>
        ) : null}
        {rejecting ? (
          <>
            <Text style={label(t)}>Γιατί την απορρίπτεις;</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["Πολύ φόρτος", "Δεν υπάρχει είδος", "Κλείνουμε", "Εκτός περιοχής"].map((x) => <Chip key={x} t={t} label={x} onPress={() => onReject(x)} />)}</View>
            <Big t={t} tone="quiet" label="Πίσω" onPress={() => setRejecting(false)} />
          </>
        ) : (
          <>
            <Text style={label(t)}>Σε πόσα λεπτά θα είναι έτοιμη;</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[10, 15, 20, 25, 30, 45].map((m) => <Chip key={m} t={t} label={`${m}′`} on={m === min} onPress={() => setMin(m)} w={72} />)}</View>
            <Big t={t} label={busy ? "Περίμενε…" : `Αποδοχή · έτοιμη στις ${hhmm(at)}`} onPress={() => onAccept(min)} disabled={busy} Icon={Check} />
            <Big t={t} tone="bad" label="Απόρριψη" onPress={() => setRejecting(true)} disabled={busy} />
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

// ---- Τηλεφωνική χωρίς τηλεφωνικό κέντρο: γράφεις το τηλέφωνο, βρίσκει τον πελάτη ----

function PhoneLookup({ t, session, onClose, onFound }: { t: Theme; session: Session; onClose: () => void; onFound: (c: Customer | null, phone: string) => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const go = async () => {
    setBusy(true);
    try { onFound(await findCustomer(session, phone), phone.replace(/\D/g, "")); }
    catch (e) { setError(fail(e)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet t={t} title="Τηλεφωνική παραγγελία" onClose={onClose} width={440}>
      <View style={{ paddingHorizontal: 24, gap: 12 }}>
        <Text style={label(t)}>Τηλέφωνο πελάτη</Text>
        <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus placeholder="69…" placeholderTextColor={t.faint} style={[field(t), num]} accessibilityLabel="Τηλέφωνο πελάτη" onSubmitEditing={go} />
        {error ? <Text style={ty(12.5, "m", t.bad)}>{error}</Text> : null}
        <Big t={t} label={busy ? "Περίμενε…" : "Βρες τον πελάτη"} onPress={() => void go()} disabled={busy || phone.replace(/\D/g, "").length < 10} />
      </View>
    </Sheet>
  );
}

// ---- 1 και 2 · Καρτέλα κλήσης ----

/** Ρωτά κάθε 2″ αν χτυπά τηλέφωνο για αυτό το ταμείο και ανοίγει την καρτέλα. */
export function CallWatcher({ t, session, onOrder, onReservation }: { t: Theme; session: Session; onOrder: (d: OrderDraft, lines?: OrderLine[]) => void; onReservation: () => void }) {
  const [live, setLive] = useState<{ id: string; phone: string; customer: Customer | null; ringing: boolean }>();
  const closed = useRef(new Set<string>());
  useEffect(() => {
    let stop = false;
    const tick = () => getLiveCall(session).then((c) => {
      if (stop) return;
      if (c && !closed.current.has(c.id)) setLive((prev) => ({ id: c.id, phone: c.phone, customer: prev?.id === c.id && prev.customer ? prev.customer : c.customer, ringing: c.state === "RINGING" }));
    }, () => {}); // σιωπηλά: χωρίς δίκτυο δεν υπάρχει κλήση να δείξουμε
    void tick();
    const id = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [session]);
  if (!live) return null;
  const close = () => { closed.current.add(live.id); void seeCall(session, live.id).catch(() => {}); setLive(undefined); };
  return (
    <CustomerSheet t={t} session={session} phone={live.phone} customer={live.customer} ringing={live.ringing} onClose={close}
      onCreated={(c) => setLive({ ...live, customer: c })}
      onOrder={(d, lines) => { close(); onOrder({ ...d, callId: live.id }, lines); }}
      onReservation={() => { close(); onReservation(); }} />
  );
}

export function CustomerSheet({ t, session, phone, customer, ringing, onClose, onCreated, onOrder, onReservation }: {
  t: Theme; session: Session; phone: string; customer: Customer | null; ringing?: boolean; onClose: () => void; onCreated: (c: Customer) => void;
  onOrder: (d: OrderDraft, lines?: OrderLine[]) => void; onReservation?: () => void;
}) {
  const [addr, setAddr] = useState(0);
  const title = ringing ? "Χτυπά τώρα" : "Πελάτης";
  if (!customer) return <Sheet t={t} title={`${title} · ${phoneText(phone)}`} onClose={onClose}><NewCustomer t={t} session={session} phone={phone} onClose={onClose} onCreated={onCreated} /></Sheet>;
  const c = customer;
  const a = c.addresses[addr];
  const draft = (delivery: boolean): OrderDraft => ({ name: c.name, phone: c.phone, partyId: c.partyId ?? undefined, delivery, address: delivery ? a?.street : undefined });
  const max = Math.max(1, ...c.months.map((m) => m.count));
  return (
    <Sheet t={t} title={c.name || phoneText(phone)} onClose={onClose} width={600}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {ringing ? <Badge t={t} text="Χτυπά τώρα" color={t.ok} /> : null}
          <Text style={[ty(14, "m", t.muted), num]}>{phoneText(c.phone)}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[[String(c.facts.orders), "παραγγελίες (6 μήνες)"], [c.facts.avgCents ? euro(c.facts.avgCents) : "—", "μέση παραγγελία"], [String(c.facts.reservations), "κρατήσεις"]].map(([v, l]) => (
            <View key={l} style={{ flex: 1, backgroundColor: t.card, borderRadius: 12, padding: 12, gap: 2 }}><Text style={[ty(20, "b", t.text), num]}>{v}</Text><Text style={ty(12, "m", t.muted)}>{l}</Text></View>
          ))}
        </View>
        {c.addresses.length ? (
          <View style={{ gap: 6 }}>
            <Text style={label(t)}>Διεύθυνση διανομής</Text>
            {c.addresses.map((x, i) => (
              <Pressable key={i} onPress={() => setAddr(i)} accessibilityRole="radio" accessibilityState={{ checked: i === addr }} style={{ flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: i === addr ? t.raised : t.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: i === addr ? t.muted : "transparent" }}>
                <MapPin size={16} strokeWidth={1.75} color={t.muted} />
                <View style={{ flex: 1 }}><Text style={ty(14, "s", t.text)}>{x.street}</Text><Text style={[ty(12, "m", t.muted), num]}>{[x.label, km(x.meters) ? `${km(x.meters)} από το κατάστημα` : null, x.note].filter(Boolean).join(" · ")}</Text></View>
              </Pressable>
            ))}
          </View>
        ) : null}
        {c.note ? <View style={{ flexDirection: "row", gap: 8, backgroundColor: tint(t.wait), borderRadius: 12, padding: 12 }}><StickyNote size={16} strokeWidth={1.75} color={t.wait} /><Text style={[ty(13, "m", t.wait), { flex: 1 }]}>{c.note}</Text></View> : null}
        {c.orders.length ? (
          <View style={{ gap: 6 }}>
            <Text style={label(t)}>Τελευταίες παραγγελίες</Text>
            {c.orders.slice(0, 2).map((o) => (
              <View key={o.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.card, borderRadius: 12, padding: 12 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={2} style={ty(13.5, "s", t.text)}>{linesText(o.lines)}</Text>
                  <Text style={[ty(12, "m", t.muted), num]}>{new Date(o.createdAt).toLocaleDateString("el-GR", { day: "numeric", month: "short", timeZone: "Europe/Athens" })} · {SOURCE[o.source]} · {euro(o.totalCents)}</Text>
                </View>
                <Pressable onPress={() => onOrder(draft(o.delivery), o.lines)} accessibilityRole="button" accessibilityLabel="Ίδια παραγγελία ξανά" style={({ pressed }) => ({ height: 44, paddingHorizontal: 14, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: pressed ? t.panel : t.raised })}>
                  <RotateCcw size={16} strokeWidth={1.75} color={t.text} /><Text style={ty(13.5, "s", t.text)}>Ξανά</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {c.facts.orders ? (
          <View style={{ gap: 6 }} accessibilityLabel={`Παραγγελίες ανά μήνα: ${c.months.map((m) => m.count).join(", ")}`}>
            <Text style={label(t)}>Παραγγελίες ανά μήνα</Text>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 72 }}>
              {c.months.map((m, i) => (
                <View key={m.month} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                  <Text style={[ty(11.5, "m", t.muted), num]}>{m.count || ""}</Text>
                  <View style={{ width: "70%", height: Math.max(3, (m.count / max) * 44), borderRadius: 4, backgroundColor: i === c.months.length - 1 ? t.ok : t.raised }} />
                  <Text style={ty(11.5, "m", t.faint)}>{new Date(`${m.month}-15`).toLocaleDateString("el-GR", { month: "short" })}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ gap: 10 }}>
          <Big t={t} label="Νέα παραγγελία διανομής" onPress={() => onOrder(draft(true))} Icon={Bike} disabled={!a} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Big t={t} tone="quiet" label="Παραλαβή" onPress={() => onOrder(draft(false))} Icon={ShoppingBag} /></View>
            {onReservation ? <View style={{ flex: 1 }}><Big t={t} tone="quiet" label="Κράτηση" onPress={onReservation} /></View> : null}
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

function NewCustomer({ t, session, phone, onClose, onCreated }: { t: Theme; session: Session; phone: string; onClose: () => void; onCreated: (c: Customer) => void }) {
  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    try { onCreated(await createCustomer(session, { name: name.trim(), phone, street: street.trim(), city: city.trim() || undefined, note: note.trim() || undefined })); }
    catch (e) { setError(fail(e)); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={[ty(13.5, "m", t.muted), { lineHeight: 20 }]}>Άγνωστος αριθμός. Αν είναι παραγγελία, γράψε τα στοιχεία του για τη διανομή.</Text>
      <Text style={label(t)}>Όνομα</Text>
      <TextInput value={name} onChangeText={setName} autoCapitalize="words" style={field(t)} accessibilityLabel="Όνομα" />
      <Text style={label(t)}>Διεύθυνση</Text>
      <TextInput value={street} onChangeText={setStreet} placeholder="Οδός και αριθμός" placeholderTextColor={t.faint} style={field(t)} accessibilityLabel="Διεύθυνση" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 6 }}><Text style={label(t)}>Περιοχή</Text><TextInput value={city} onChangeText={setCity} style={field(t)} accessibilityLabel="Περιοχή" /></View>
        <View style={{ flex: 1, gap: 6 }}><Text style={label(t)}>Για τον διανομέα</Text><TextInput value={note} onChangeText={setNote} placeholder="όροφος, κουδούνι" placeholderTextColor={t.faint} style={field(t)} accessibilityLabel="Σημείωση για τον διανομέα" /></View>
      </View>
      <Text style={ty(12, "m", t.faint)}>Τα στοιχεία κρατιούνται για τις παραγγελίες του. Ο πελάτης μπορεί να ζητήσει να σβηστούν.</Text>
      {error ? <Text style={ty(12.5, "m", t.bad)}>{error}</Text> : null}
      <Big t={t} label={busy ? "Περίμενε…" : "Αποθήκευση πελάτη"} onPress={() => void save()} disabled={busy || !name.trim() || street.trim().length < 3} />
      <Big t={t} tone="quiet" label="Δεν είναι παραγγελία" onPress={onClose} Icon={X} />
    </ScrollView>
  );
}

// ---- 3 · Αποστολή τηλεφωνικής για ετοιμασία ----

export function OrderSendSheet({ t, session, draft, lines, totalCents, onClose, onSent, onUnpaired }: {
  t: Theme; session: Session; draft: OrderDraft; lines: SaleLine[]; totalCents: number; onClose: () => void; onSent: () => void; onUnpaired: () => void;
}) {
  const [delivery, setDelivery] = useState(draft.delivery);
  const [address, setAddress] = useState(draft.address ?? "");
  const [name, setName] = useState(draft.name);
  const [min, setMin] = useState(draft.delivery ? 30 : 15);
  const [payment, setPayment] = useState<"DOOR_CASH" | "DOOR_CARD" | "TILL">(draft.delivery ? "DOOR_CASH" : "TILL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [opened] = useState(() => Date.now());
  const pays = delivery ? (["DOOR_CASH", "DOOR_CARD"] as const) : (["TILL"] as const);
  const send = async () => {
    setBusy(true);
    try {
      await createPhoneOrder(session, { lines, name: name.trim(), phone: draft.phone, partyId: draft.partyId, address: delivery ? address.trim() : undefined, delivery, payment: delivery ? (payment === "TILL" ? "DOOR_CASH" : payment) : "TILL", readyInMin: min, note: note.trim() || undefined, callId: draft.callId });
      onSent();
    } catch (e) { if (unpairedBy(e)) onUnpaired(); else setError(fail(e)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet t={t} title="Στοιχεία παραγγελίας" onClose={onClose}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Chip t={t} label="Διανομή" on={delivery} onPress={() => { setDelivery(true); setPayment("DOOR_CASH"); setMin(30); }} /></View>
          <View style={{ flex: 1 }}><Chip t={t} label="Παραλαβή" on={!delivery} onPress={() => { setDelivery(false); setPayment("TILL"); setMin(15); }} /></View>
        </View>
        <Text style={label(t)}>Όνομα</Text>
        <TextInput value={name} onChangeText={setName} style={field(t)} accessibilityLabel="Όνομα" />
        {delivery ? <><Text style={label(t)}>Διεύθυνση</Text><TextInput value={address} onChangeText={setAddress} style={field(t)} accessibilityLabel="Διεύθυνση" /></> : null}
        <Text style={label(t)}>Έτοιμη σε</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{[15, 20, 30, 45, 60].map((m) => <Chip key={m} t={t} label={`${m}′`} sub={hhmm(new Date(opened + m * 60_000).toISOString())} on={m === min} onPress={() => setMin(m)} w={76} />)}</View>
        <Text style={label(t)}>Πληρωμή</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>{pays.map((p) => <View key={p} style={{ flex: 1 }}><Chip t={t} label={PAYMENT[p]} on={p === payment} onPress={() => setPayment(p)} /></View>)}</View>
        <Text style={label(t)}>Σημείωση</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="π.χ. χωρίς κουτάλια" placeholderTextColor={t.faint} style={field(t)} accessibilityLabel="Σημείωση" />
        {error ? <Text style={ty(12.5, "m", t.bad)}>{error}</Text> : null}
        <Pressable onPress={() => void send()} disabled={busy || !name.trim() || (delivery && address.trim().length < 3)} accessibilityRole="button"
          style={({ pressed }) => ({ height: 56, borderRadius: 28, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: busy || !name.trim() || (delivery && address.trim().length < 3) ? 0.35 : pressed ? 0.85 : 1 })}>
          <Text style={ty(16, "s", t.onAction)}>{busy ? "Περίμενε…" : "Στείλε για ετοιμασία"}</Text>
          <Text style={[ty(16, "b", t.onAction), num]}>{euro(totalCents)}</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}
