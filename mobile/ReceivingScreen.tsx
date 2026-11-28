// Παραλαβή από το κινητό: φωτογραφία δελτίου → παραγγελία → σάρωση barcode ανά κιβώτιο → τι λείπει → καταχώριση.
// Ύφος: docs/analysis/mockups/mobile-receiving.html, στο σκούρο θέμα του ταμείου. Για κινητό σε κάθετη θέση.
import { CameraView, useCameraPermissions } from "expo-camera";
import { AlertTriangle, Camera, MapPin, Check, ChevronDown, ChevronLeft, ChevronUp, CircleCheck, Clock, Info, Receipt, Minus, PackageCheck, Phone, Plus, ScanBarcode, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, Vibration, View } from "react-native";
import { ApiError, type Session } from "./api";
import { loadReceivingDraft, saveReceivingDraft } from "./offline-store";
import { addScan, putaway, type Counted, type Decision, type DeliveryNote, matchScan, takeMydata, type Spot, type SupplierPhone, noteBase, noteMatches, packs, type ReceivingLine, type ReceivingOrder, submission } from "./receiving";
import { getOpenOrders, readNote, submitReceipt } from "./receiving-api";
import { type Theme, tint, ty } from "./theme";
import { Btn, Seg } from "./TransactionsScreen";
import { SpotSheet } from "./StockScreen";

const num = { fontVariant: ["tabular-nums" as const] };
const ICON = { size: 18, strokeWidth: 1.75 };
const BARCODES = ["ean13", "ean8", "upc_a", "code128", "datamatrix", "qr"] as const;
const fail = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : e instanceof ApiError && e.status === 0 ? "Δεν υπάρχει σύνδεση. Η σάρωση έχει κρατηθεί στο κινητό, δοκίμασε ξανά." : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const dmy = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const key = () => `rcv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Ποσότητα σε kg / l / τεμ. για να τη διαβάζει ο αποθηκάριος. */
function amount(base: number, dimension: string) {
  if (dimension === "mass") return `${(base / 1_000_000).toLocaleString("el-GR", { maximumFractionDigits: 2 })} kg`;
  if (dimension === "volume") return `${(base / 1000).toLocaleString("el-GR", { maximumFractionDigits: 2 })} l`;
  return `${base} τεμ.`;
}

type Draft = { orderId: string; clientKey: string; note: DeliveryNote | null; counted: Record<string, Counted>; decisions: Record<string, Decision> };
type Step = "start" | "orders" | "scan" | "finish" | "done";

export function ReceivingView({ t, session, onUnpaired }: { t: Theme; session: Session; onUnpaired: () => void }) {
  const [step, setStep] = useState<Step>("start");
  const [orders, setOrders] = useState<ReceivingOrder[]>();
  const [note, setNote] = useState<DeliveryNote | null>(null);
  const [draft, setDraft] = useState<Draft>();
  const [placing, setPlacing] = useState<Result["in"][number]>();
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();

  const guard = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(undefined);
    try { await fn(); } catch (e) { if (e instanceof ApiError && e.status === 401) onUnpaired(); else setError(fail(e)); } finally { setBusy(undefined); }
  }, [onUnpaired]);

  const load = useCallback(() => guard("Φορτώνω τις παραγγελίες…", async () => setOrders(await getOpenOrders(session))), [guard, session]);
  useEffect(() => {
    getOpenOrders(session).then(setOrders, (e) => { if (e instanceof ApiError && e.status === 401) onUnpaired(); else setError(fail(e)); });
    void loadReceivingDraft<Draft>().then((d) => { if (d) { setDraft(d); setNote(d.note); setStep("scan"); } });
  }, [session, onUnpaired]);
  useEffect(() => { if (draft) void saveReceivingDraft(draft); }, [draft]);

  const order = orders?.find((o) => o.id === draft?.orderId);
  const reset = () => { setDraft(undefined); setNote(null); void saveReceivingDraft(null); setStep("start"); void load(); };
  const pick = (o: ReceivingOrder) => { setDraft({ orderId: o.id, clientKey: key(), note, counted: {}, decisions: {} }); setStep("scan"); };

  const header = (title: string, sub?: string, back?: () => void, phones?: SupplierPhone[]) => (<>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
      {back ? <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Πίσω" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -10 }}><ChevronLeft {...ICON} color={t.text} /></Pressable> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ty(19, "s", t.text)} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={[ty(13, "m", t.muted), num]} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
    {phones?.length ? <Calls t={t} phones={phones} /> : null}
  </>);
  const errorBox = error ? (
    <View style={{ flexDirection: "row", gap: 10, marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: tint(t.bad) }}>
      <AlertTriangle {...ICON} color={t.bad} /><Text style={[ty(13.5, "m", t.text), { flex: 1 }]}>{error}</Text>
    </View>
  ) : null;

  if (busy && step !== "scan" && step !== "finish") return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
      <ActivityIndicator color={t.text} /><Text style={ty(15, "m", t.muted)}>{busy}</Text>
    </View>
  );

  if (step === "start") return <StartStep t={t} header={header("Νέα παραλαβή", "Φωτογράφισε το δελτίο αποστολής")} errorBox={errorBox}
    onPhoto={(b64) => guard("Διαβάζω το δελτίο…", async () => { setNote(await readNote(session, b64)); setStep("orders"); })}
    onSkip={() => { setNote(null); setStep("orders"); }} />;

  if (step === "orders") {
    const supplierId = note?.supplier?.id;
    const list = (orders ?? []).filter((o) => !supplierId || o.supplier.id === supplierId).sort((a, b) => noteMatches(note, b) - noteMatches(note, a));
    return (
      <View style={{ flex: 1 }}>
        {header(note ? `Δελτίο ${note.number ?? "χωρίς αριθμό"}` : "Διάλεξε παραγγελία", note ? "Διαβάστηκε από τη φωτογραφία" : "Ανοιχτές παραγγελίες και όσα περιμένουμε", () => setStep("start"))}
        {errorBox}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>
          {note ? (
            <View style={{ borderRadius: 16, backgroundColor: t.card, padding: 16, gap: 10 }}>
              <Row t={t} label="Προμηθευτής" value={note.supplier?.name ?? (note.vatNumber ? `ΑΦΜ ${note.vatNumber} · δεν βρέθηκε` : "δεν διαβάστηκε")} tone={note.supplier ? undefined : t.wait} />
              <Row t={t} label="Ημερομηνία" value={dmy(note.date)} />
              {note.mark ? <Row t={t} label="MARK" value={note.mark} /> : null}
              <Row t={t} label="Γραμμές" value={`${note.lines.length} είδη`} />
            </View>
          ) : null}
          {note?.mydata ? <MydataCard t={t} note={note} onAade={() => setNote(takeMydata(note))} onPaper={() => setNote({ ...note, mydataPaper: true })} />
            : note && !note.mark && note.vatNumber && note.number ? (
              <View style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: t.card }}>
                <Info {...ICON} color={t.muted} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={ty(15, "s", t.text)}>Θα ελεγχθεί με ΑΦΜ και αριθμό</Text>
                  <Text style={ty(13, "m", t.muted)}>Το δελτίο δεν τυπώνει MARK. Ο έλεγχος με το myDATA γίνεται το βράδυ.</Text>
                </View>
              </View>
            ) : null}
          {note?.already ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: tint(t.bad) }}>
                <AlertTriangle {...ICON} color={t.bad} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={ty(15, "s", t.text)}>Το δελτίο έχει ήδη καταχωριστεί</Text>
                  <Text style={[ty(13.5, "m", t.text), num]}>{note.already.message}</Text>
                  <Text style={ty(12.5, "m", t.muted)}>Δεν γίνεται δεύτερη παραλαβή με το ίδιο δελτίο. Αν ήρθαν κι άλλα είδη, φωτογράφισε το δικό τους δελτίο.</Text>
                </View>
              </View>
              <Btn t={t} label="Άλλο δελτίο" Icon={Camera} onPress={() => { setNote(null); setStep("start"); }} primary />
            </View>
          ) : <>
          <Text style={[ty(14, "s", t.muted), { marginTop: 4 }]}>Σε ποια παραγγελία ανήκει;</Text>
          {list.length === 0 ? <Text style={ty(14, "m", t.muted)}>{supplierId ? "Δεν υπάρχει ανοιχτή παραγγελία από αυτόν τον προμηθευτή." : "Δεν υπάρχει ανοιχτή παραγγελία για τις αποθήκες αυτού του καταστήματος."}</Text> : null}
          {list.map((o, i) => {
            const m = noteMatches(note, o);
            const waiting = o.lines.filter((l) => l.expectedAt).length;
            return (
              <Pressable key={o.id} onPress={() => pick(o)} accessibilityRole="button" style={({ pressed }) => ({ borderRadius: 16, padding: 16, gap: 6, backgroundColor: pressed ? t.raised : t.card, borderWidth: 1, borderColor: note && i === 0 && m ? t.ok : t.line })}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={[ty(16, "s", t.text), num]}>{o.number} · {dmy(o.createdAt).slice(0, 5)}</Text>
                  {note && m ? <Text style={[ty(13, "s", t.ok), num]}>ταιριάζουν {m}</Text> : null}
                </View>
                {supplierId ? null : <Text style={ty(13.5, "m", t.muted)} numberOfLines={1}>{o.supplier.name}</Text>}
                <Text style={[ty(13.5, "m", t.muted), num]}>{o.lines.length} είδη περιμένουμε{waiting ? ` · ${waiting} αναμένονται από παλιότερο δελτίο` : ""}</Text>
              </Pressable>
            );
          })}
          {list.length > 1 && note ? <Text style={ty(12.5, "m", t.faint)}>Πρώτα καλύπτεται η παλιότερη παραγγελία.</Text> : null}
          </>}
        </ScrollView>
      </View>
    );
  }

  if (step === "done") {
  const group = (title: string, color: string, Icon: typeof Check, rows: Result["in"]) => rows.length ? (
    <View style={{ borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Icon size={16} strokeWidth={2} color={color} /><Text style={ty(14, "s", color)}>{title}</Text></View>
      {rows.map((r) => (
        <View key={r.genericItemId} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <Text style={[ty(14, "m", t.text), { flex: 1 }]} numberOfLines={2}>{r.name}</Text>
          <Text style={[ty(14, "s", t.text), num]}>{r.qty}</Text>
        </View>
      ))}
    </View>
  ) : null;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={{ alignItems: "center", gap: 10, paddingVertical: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: tint(t.ok), alignItems: "center", justifyContent: "center" }}><Check size={28} strokeWidth={2} color={t.ok} /></View>
          <Text style={[ty(20, "s", t.text), { textAlign: "center" }]}>Η παραλαβή καταχωρίστηκε</Text>
          {result ? <Text style={[ty(14, "m", t.muted), num, { textAlign: "center" }]} numberOfLines={2}>{result.title}</Text> : null}
        </View>
        {result ? <>
          {group("Μπήκαν στην αποθήκη", t.ok, PackageCheck, result.in)}
          {result.in.length ? (
            <View style={{ borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><MapPin size={16} strokeWidth={2} color={t.text} /><Text style={ty(14, "s", t.text)}>Τακτοποίηση{result.warehouse ? ` · ${result.warehouse.name}` : ""}</Text></View>
              {putaway(result.in).map((g) => (
                <View key={g.spot?.id ?? "none"} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.divider }}>
                  <Text style={ty(13, "s", g.spot ? t.text : t.wait)}>{g.spot ? g.spot.name : "Χωρίς θέση ακόμα · όρισέ τη μία φορά"}</Text>
                  {g.items.map((r) => (
                    <View key={r.genericItemId} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={[ty(14, "m", t.text), { flex: 1 }]} numberOfLines={1}>{r.name}</Text>
                      {result.warehouse ? <Pressable onPress={() => setPlacing(r)} accessibilityRole="button" accessibilityLabel={`Θέση για ${r.name}`}
                        style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 10, borderRadius: 10, justifyContent: "center", backgroundColor: pressed ? t.raised : t.panel })}>
                        <Text style={ty(13, "s", r.spot ? t.muted : t.text)}>{r.spot ? "Αλλαγή" : "Όρισε θέση"}</Text>
                      </Pressable> : null}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
          {group("Τα περιμένουμε από τον προμηθευτή", t.wait, Clock, result.wait)}
          {group("Πιστωτικό από τον προμηθευτή", t.bad, Receipt, result.credit)}
          {result.remark ? <Text style={ty(13, "m", t.wait)}>{result.remark}</Text> : null}
          <Text style={ty(13, "m", t.muted)}>{result.complete ? "Η παραγγελία ολοκληρώθηκε." : "Η παραγγελία μένει ανοιχτή για όσα περιμένουμε."} Ο υπεύθυνος αγορών βλέπει το δελτίο στη σελίδα της παραγγελίας.</Text>
        </> : <Text style={[ty(14, "m", t.muted), { textAlign: "center" }]}>Το απόθεμα ενημερώθηκε.</Text>}
      </ScrollView>
      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: t.divider }}><Btn t={t} label="Νέα παραλαβή" onPress={() => { setResult(undefined); reset(); }} primary /></View>
      {placing && result?.warehouse ? <SpotSheet t={t} session={session} item={{ ...placing, warehouseId: result.warehouse.id }} spots={result.spots} onClose={() => setPlacing(undefined)}
        onDone={(spot) => { setPlacing(undefined); setResult({ ...result, spots: result.spots.some((x) => x.id === spot.id) ? result.spots : [...result.spots, spot], in: result.in.map((r) => (r.genericItemId === placing.genericItemId ? { ...r, spot } : r)) }); }} /> : null}
    </View>
  );
  }

  if (!order || !draft) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
      <Text style={[ty(15, "m", t.muted), { textAlign: "center" }]}>{orders ? "Η παραγγελία δεν είναι πια ανοιχτή." : "Φορτώνω…"}</Text>
      {orders ? <Btn t={t} label="Νέα παραλαβή" onPress={reset} primary /> : null}
    </View>
  );

  if (step === "scan") return <ScanStep t={t} order={order} draft={draft} errorBox={errorBox} header={header(`${draft.note?.number ? `${draft.note.number} · ` : ""}${order.number}`, order.supplier.name, () => setStep("orders"), order.supplier.phones)}
    onCount={(counted) => setDraft({ ...draft, counted })} onDone={() => setStep("finish")} />;

  if (step === "finish") {
    const body = submission(order, draft.counted, draft.decisions, draft.note);
    const short = order.lines.filter((l) => (draft.counted[l.id]?.base ?? 0) < l.missing);
    const fewer = order.lines.filter((l) => { const n = noteBase(draft.note, l); return n && (draft.counted[l.id]?.base ?? 0) < n; });
    return (
      <View style={{ flex: 1 }}>
        {header("Τι έλειψε", `Ήρθαν ${order.lines.reduce((n, l) => n + packs(draft.counted[l.id]?.base ?? 0, l.packBase), 0)} από ${order.lines.reduce((n, l) => n + packs(noteBase(draft.note, l) ?? l.missing, l.packBase), 0)}`, () => setStep("scan"), order.supplier.phones)}
        {errorBox}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
          {fewer.length ? (
            <View style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: tint(t.wait) }}>
              <AlertTriangle {...ICON} color={t.wait} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={ty(14, "s", t.text)}>Λιγότερα από όσα γράφει το δελτίο</Text>
                {fewer.map((l) => <Text key={l.id} style={[ty(13, "m", t.muted), num]}>{l.name}: {packs(draft.counted[l.id]?.base ?? 0, l.packBase)} αντί για {packs(noteBase(draft.note, l)!, l.packBase)}</Text>)}
                <Text style={ty(12.5, "m", t.faint)}>Σημειώνεται στην παραλαβή για τον υπεύθυνο αγορών.</Text>
              </View>
            </View>
          ) : null}
          {short.length ? <Text style={[ty(14, "s", t.muted), { marginTop: 4 }]}>Όσα λείπουν από την παραγγελία</Text> : (
            <View style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: tint(t.ok) }}>
              <CircleCheck {...ICON} color={t.ok} /><Text style={[ty(14, "s", t.text), { flex: 1 }]}>Ήρθαν όλα. Η παραγγελία κλείνει με αυτή την παραλαβή.</Text>
            </View>
          )}
          {short.map((l) => (
            <View key={l.id} style={{ borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={[ty(15, "s", t.text), { flex: 1 }]} numberOfLines={1}>{l.name}</Text>
                <Text style={[ty(14, "s", t.wait), num]}>λείπουν {amount(l.missing - Math.min(draft.counted[l.id]?.base ?? 0, l.missing), l.dimension)}</Text>
              </View>
              <Seg t={t} value={draft.decisions[l.id] ?? "wait"} onChange={(v) => setDraft({ ...draft, decisions: { ...draft.decisions, [l.id]: v } })} items={[["wait", "Τα περιμένουμε"], ["close", "Πιστωτικό"]]} />
            </View>
          ))}
        </ScrollView>
        <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: t.divider }}>
          <Text style={[ty(13, "m", t.muted), num]}>Μπαίνουν τώρα στην αποθήκη {body.lines.length} είδη, με παρτίδα και λήξη όπου σαρώθηκαν</Text>
          <Btn t={t} label={busy ? "Καταχωρίζω…" : "Καταχώριση παραλαβής"} Icon={PackageCheck} primary disabled={!!busy || !body.lines.length}
            onPress={() => guard("Καταχωρίζω…", async () => { await submitReceipt(session, { ...body, clientKey: draft.clientKey }); setResult(summarize(order, draft)); setDraft(undefined); setNote(null); setStep("done"); await saveReceivingDraft(null); })} />
        </View>
      </View>
    );
  }

}

type SumRow = { name: string; qty: string; genericItemId: string; spot?: Spot | null };
type Result = { title: string; complete: boolean; remark?: string; warehouse?: { id: string; name: string }; spots: Spot[]; in: SumRow[]; wait: SumRow[]; credit: SumRow[] };

/** Τι έγινε με την παραλαβή, για την οθόνη ολοκλήρωσης: όχι μόνο «έγινε», αλλά τι μπήκε, τι περιμένουμε, τι πιστώνεται. */
function summarize(order: ReceivingOrder, draft: Draft): Result {
  const got = (l: ReceivingLine) => Math.min(draft.counted[l.id]?.base ?? 0, l.missing);
  const row = (l: ReceivingLine, base: number): SumRow => ({ name: l.name, qty: `${packs(base, l.packBase)} · ${amount(base, l.dimension)}`, genericItemId: l.genericItemId, spot: l.spot ?? null });
  const left = order.lines.filter((l) => got(l) < l.missing);
  const body = submission(order, draft.counted, draft.decisions, draft.note);
  return {
    title: `${draft.note?.number ? `Δελτίο ${draft.note.number} · ` : ""}${order.number} · ${order.supplier.name}`,
    complete: left.length === 0,
    remark: body.remark,
    warehouse: order.warehouse, spots: order.spots ?? [],
    in: order.lines.filter((l) => got(l) > 0).map((l) => row(l, got(l))),
    wait: left.filter((l) => (draft.decisions[l.id] ?? "wait") === "wait").map((l) => row(l, l.missing - got(l))),
    credit: left.filter((l) => draft.decisions[l.id] === "close").map((l) => row(l, l.missing - got(l))),
  };
}

/** Τηλέφωνα προμηθευτή και επαφών σε accordion: κλειστό πιάνει μία γραμμή, ένα πάτημα στη γραμμή καλεί. */
function Calls({ t, phones }: { t: Theme; phones: SupplierPhone[] }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, overflow: "hidden" }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 14, backgroundColor: pressed ? t.raised : "transparent" })}>
        <Phone size={16} strokeWidth={2} color={t.ok} />
        <Text style={[ty(14, "s", t.text), { flex: 1 }]} numberOfLines={1}>Επικοινωνία με τον προμηθευτή</Text>
        <Text style={[ty(13, "m", t.muted), num]}>{phones.length}</Text>
        <Chevron {...ICON} color={t.muted} />
      </Pressable>
      {open ? phones.map((p) => (
        <Pressable key={p.phone} onPress={() => void Linking.openURL(`tel:${p.phone.replace(/[^+\d]/g, "")}`)} accessibilityRole="button" accessibilityLabel={`Κλήση ${p.who} ${p.phone}`}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.divider, backgroundColor: pressed ? t.raised : "transparent" })}>
          <View style={{ flex: 1, minWidth: 0, paddingLeft: 28 }}>
            <Text style={ty(14, "m", t.text)} numberOfLines={1}>{p.who}</Text>
            {p.label ? <Text style={ty(12.5, "m", t.muted)} numberOfLines={1}>{p.label}</Text> : null}
          </View>
          <Text style={[ty(14, "s", t.ok), num]}>{p.phone}</Text>
        </Pressable>
      )) : null}
    </View>
  );
}

function Row({ t, label, value, tone }: { t: Theme; label: string; value: string; tone?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={ty(13.5, "m", t.muted)}>{label}</Text>
      <Text style={[ty(14, "s", tone ?? t.text), num, { flexShrink: 1, textAlign: "right" }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function StartStep({ t, header, errorBox, onPhoto, onSkip }: { t: Theme; header: React.ReactNode; errorBox: React.ReactNode; onPhoto: (b64: string) => void; onSkip: () => void }) {
  const [permission, ask] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const shoot = async () => {
    const p = await cam.current?.takePictureAsync({ base64: true, quality: 0.5 });
    if (p?.base64) onPhoto(p.base64);
  };
  return (
    <View style={{ flex: 1 }}>
      {header}
      {errorBox}
      <View style={{ flex: 1, marginHorizontal: 16, borderRadius: 16, overflow: "hidden", backgroundColor: t.panel, alignItems: "center", justifyContent: "center" }}>
        {permission?.granted ? (
          <>
            <CameraView ref={cam} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} facing="back" />
            <View pointerEvents="none" style={{ position: "absolute", top: 24, left: 24, right: 24, bottom: 56, borderRadius: 12, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" }} />
            <Text style={[ty(13.5, "m", "#fff"), { position: "absolute", bottom: 20 }]}>Βάλε όλο το δελτίο μέσα στο πλαίσιο</Text>
          </>
        ) : (
          <View style={{ alignItems: "center", gap: 12, padding: 24 }}>
            <Camera size={28} strokeWidth={1.75} color={t.muted} />
            <Text style={[ty(14, "m", t.muted), { textAlign: "center" }]}>Η εφαρμογή χρειάζεται την κάμερα για το δελτίο και τα barcodes</Text>
            <Btn t={t} label="Άνοιξε την κάμερα" onPress={() => void ask()} />
          </View>
        )}
      </View>
      <View style={{ padding: 16, gap: 8 }}>
        <Btn t={t} label="Φωτογραφία δελτίου" Icon={Camera} primary disabled={!permission?.granted} onPress={() => void shoot()} />
        <Btn t={t} label="Χωρίς δελτίο · διάλεξε παραγγελία" onPress={onSkip} />
      </View>
    </View>
  );
}

function ScanStep({ t, order, draft, header, errorBox, onCount, onDone }: { t: Theme; order: ReceivingOrder; draft: Draft; header: React.ReactNode; errorBox: React.ReactNode; onCount: (c: Record<string, Counted>) => void; onDone: () => void }) {
  const [permission, ask] = useCameraPermissions();
  const [toast, setToast] = useState<{ ok: boolean; text: string }>();
  const [typed, setTyped] = useState("");
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const counted = draft.counted;
  const target = (l: ReceivingLine) => noteBase(draft.note, l) ?? l.missing;
  const totalPacks = order.lines.reduce((s, l) => s + packs(target(l), l.packBase), 0);
  const donePacks = order.lines.reduce((s, l) => s + packs(counted[l.id]?.base ?? 0, l.packBase), 0);

  const scan = (raw: string, camera = false) => {
    const now = Date.now();
    if (camera && raw === last.current.code && now - last.current.at < 1500) return; // η κάμερα διαβάζει το ίδιο κιβώτιο πολλές φορές
    if (camera) last.current = { code: raw, at: now };
    const hit = matchScan(raw, order.lines);
    if (!hit) { Vibration.vibrate(300); setToast({ ok: false, text: `Το barcode ${raw} δεν ανήκει σε αυτή την παραγγελία` }); return; }
    const l = order.lines.find((x) => x.id === hit.lineId)!;
    onCount(addScan(counted, hit));
    setToast({ ok: true, text: `+1 ${l.name}${hit.batch ? ` · παρτίδα ${hit.batch}` : ""}${hit.expiry ? ` · λήξη ${dmy(hit.expiry)}` : ""}` });
  };
  const step = (l: ReceivingLine, sign: 1 | -1) => {
    const base = Math.max(0, (counted[l.id]?.base ?? 0) + sign * l.packBase);
    onCount({ ...counted, [l.id]: { ...counted[l.id], base } });
  };

  return (
    <View style={{ flex: 1 }}>
      {header}
      <View style={{ marginHorizontal: 16, marginBottom: 12, gap: 6 }}>
        <Text style={[ty(14, "s", t.text), num]}>Σαρώθηκαν {donePacks} από {totalPacks}</Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.raised, overflow: "hidden" }}>
          <View style={{ width: `${Math.min(100, totalPacks ? (donePacks / totalPacks) * 100 : 0)}%`, height: 6, backgroundColor: t.ok }} />
        </View>
      </View>
      {errorBox}
      <View style={{ height: 170, marginHorizontal: 16, borderRadius: 16, overflow: "hidden", backgroundColor: t.panel, alignItems: "center", justifyContent: "center" }}>
        {permission?.granted ? (
          <>
            <CameraView style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} facing="back" barcodeScannerSettings={{ barcodeTypes: [...BARCODES] }} onBarcodeScanned={({ data }) => scan(data, true)} />
            <View pointerEvents="none" style={{ width: "70%", height: 2, backgroundColor: t.bad, opacity: 0.8 }} />
          </>
        ) : <Btn t={t} label="Άνοιξε την κάμερα για σάρωση" Icon={ScanBarcode} onPress={() => void ask()} />}
      </View>
      {toast ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: tint(toast.ok ? t.ok : t.bad) }}>
          {toast.ok ? <Check {...ICON} color={t.ok} /> : <X {...ICON} color={t.bad} />}
          <Text style={[ty(13.5, "m", t.text), { flex: 1 }]} numberOfLines={2}>{toast.text}</Text>
        </View>
      ) : null}
      {/* Scanner Bluetooth γράφει σαν πληκτρολόγιο και πατά Enter· το ίδιο πεδίο δέχεται και πληκτρολόγηση */}
      <TextInput value={typed} onChangeText={setTyped} onSubmitEditing={() => { if (typed.trim()) scan(typed.trim()); setTyped(""); }} blurOnSubmit={false}
        placeholder="Barcode με το χέρι ή από scanner" placeholderTextColor={t.faint} keyboardType="default" returnKeyType="done"
        style={{ ...ty(15, "m", t.text), minHeight: 48, marginHorizontal: 16, marginTop: 10, borderRadius: 12, backgroundColor: t.panel, paddingHorizontal: 14 }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
        {order.lines.map((l) => {
          const got = counted[l.id]?.base ?? 0;
          const want = target(l);
          const full = got >= want;
          const nb = noteBase(draft.note, l);
          return (
            <View key={l.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: full ? `${t.ok}59` : t.line }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={ty(15, "s", t.text)} numberOfLines={2}>{l.name}</Text>
                <Text style={[ty(12.5, "m", t.muted), num]} numberOfLines={2}>{nb ? `στο δελτίο ${packs(nb, l.packBase)} · ` : ""}υπόλοιπο {packs(l.missing, l.packBase)} · ήρθαν {amount(got, l.dimension)}</Text>
              </View>
              <Pressable onPress={() => step(l, -1)} accessibilityLabel={`Ένα λιγότερο ${l.name}`} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: t.raised }}><Minus {...ICON} color={t.text} /></Pressable>
              <Text style={[ty(16, "s", full ? t.ok : got ? t.wait : t.muted), num, { minWidth: 56, textAlign: "center" }]}>{packs(got, l.packBase)} / {packs(want, l.packBase)}</Text>
              <Pressable onPress={() => step(l, 1)} accessibilityLabel={`Ένα ακόμα ${l.name}`} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: t.raised }}><Plus {...ICON} color={t.text} /></Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: t.divider }}>
        <Btn t={t} label="Τελείωσα · δες τι λείπει" primary onPress={onDone} disabled={!donePacks} />
      </View>
    </View>
  );
}

/** Έλεγχος με το myDATA μόλις διαβαστεί το δελτίο (mockup mydata-check.html, Α). Η παραλαβή συνεχίζει σε κάθε περίπτωση. */
function MydataCard({ t, note, onAade, onPaper }: { t: Theme; note: DeliveryNote; onAade: () => void; onPaper: () => void }) {
  const c = note.mydata!;
  const look = {
    MATCH: { tone: t.ok, Icon: CircleCheck, title: "Ίδιο με το myDATA", sub: "ΑΦΜ, αριθμός, ημερομηνία και MARK συμφωνούν με αυτό που δήλωσε ο προμηθευτής στην ΑΑΔΕ." },
    DIFF: note.mydataPaper
      ? { tone: t.wait, Icon: AlertTriangle, title: "Κρατάς τα στοιχεία του χαρτιού", sub: "Η διαφορά σημειώνεται στο παραστατικό, για τον υπεύθυνο αγορών και τον προμηθευτή." }
      : { tone: t.bad, Icon: AlertTriangle, title: `${c.diff.length} ${c.diff.length === 1 ? "διαφορά" : "διαφορές"} με το myDATA`, sub: "Ή διαβάστηκε λάθος η φωτογραφία ή ο προμηθευτής δήλωσε άλλα στοιχεία. Κοίτα το χαρτί." },
    NOT_FOUND: { tone: t.wait, Icon: Clock, title: "Δεν βρέθηκε ακόμα στο myDATA", sub: "Ο προμηθευτής έχει περιθώριο να το διαβιβάσει. Η παραλαβή γίνεται κανονικά· θα ξαναελεγχθεί κάθε βράδυ και θα ειδοποιηθείς μόνο αν βρεθεί διαφορά." },
    ERROR: { tone: t.wait, Icon: Info, title: "Το myDATA δεν απάντησε τώρα", sub: "Η παραλαβή γίνεται κανονικά· ο έλεγχος θα ξαναγίνει το βράδυ." },
  }[c.status];
  return (
    <View style={{ borderRadius: 14, padding: 14, gap: 10, backgroundColor: tint(look.tone) }} accessibilityRole="summary">
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <look.Icon {...ICON} color={look.tone} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ty(15, "s", t.text)}>{look.title}</Text>
          <Text style={ty(13, "m", t.muted)}>{look.sub}</Text>
        </View>
      </View>
      {c.status === "DIFF" ? (
        <View style={{ borderRadius: 10, backgroundColor: t.card, padding: 10, gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Text style={[ty(12, "s", t.muted), { width: 84 }]}>Πεδίο</Text><Text style={[ty(12, "s", t.muted), { flex: 1 }]}>Φωτογραφία</Text><Text style={[ty(12, "s", t.muted), { flex: 1 }]}>myDATA</Text>
          </View>
          {c.diff.map((d) => (
            <View key={d.field} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={[ty(13, "m", t.text), { width: 84 }]}>{d.label}</Text>
              <Text style={[ty(13, "s", t.bad), num, { flex: 1 }]}>{d.scanned}</Text>
              <Text style={[ty(13, "s", t.ok), num, { flex: 1 }]}>{d.mydata}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {c.status === "DIFF" && !note.mydataPaper ? (
        <View style={{ gap: 8 }}>
          <Btn t={t} label="Κράτα τα στοιχεία της ΑΑΔΕ" Icon={Check} onPress={onAade} />
          <Btn t={t} label="Το χαρτί είναι σωστό" Icon={Receipt} onPress={onPaper} />
        </View>
      ) : null}
    </View>
  );
}
