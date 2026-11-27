import { getAndroidId } from "expo-application";
import { CameraView, useCameraPermissions } from "expo-camera";
import { parsePairQr } from "./pair-qr";
import { InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold, useFonts } from "@expo-google-fonts/inter-tight";
import { StatusBar } from "expo-status-bar";
import { ArrowLeft, Banknote, Bike, CakeSlice, CalendarClock, Check, Clock, Divide, Coffee, CreditCard, CupSoda, IceCreamCone, LayoutGrid, LogOut, type LucideIcon, Plus, ReceiptText, Search, SlidersHorizontal, Star, StickyNote, Tag, Trash2, TriangleAlert, Wallet, X } from "lucide-react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Linking, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { ApiError, type Bill, type BillLine, type BillPick, type BillSummary, cancelBill, type Catalog, checkResult, clearPending, clearSession, createSale, type DiningTable, getBill, getBills, getCatalog, loadPending, loadSession, openBill, type Outcome, pair, type PaymentMethod, type Pending, type Product, reportResult, savePending, saveSession, sendRound, type Session, settleBill, shareBill, syncOffline, voidBillLine } from "./api";
import { enqueue, offlineSale, type Outbox } from "./offline";
import { loadCachedCatalog, loadOutbox, saveCachedCatalog, saveOutbox } from "./offline-store";
import { ReservationsView } from "./ReservationsScreen";
import { TransactionsView } from "./TransactionsScreen";
import { CallWatcher, CustomerSheet, OrderSendSheet, OrdersView } from "./OrdersScreen";
import { type Customer, type OrderDraft, type OrderLine as PastLine, reorderLines } from "./orders";
import { CloseShiftView, DayCloseView, SignInView, WhoIsOn } from "./ShiftScreens";
import { getShift, type ShiftState } from "./shift-api";
import { hhmm, isoDay, nextByTable, type Reservation, untilText } from "./reservations";
import { getDay } from "./reservations-api";
import { dark, euro, font, type Theme, tint, ty } from "./theme";
import { amountCents, amountText, dropOption, equalSplit, type Group, missingIn, quickAmounts, retryDelayMs, tapOption, totals, typeAmount, unitPrice } from "./till";
import { isVivaResult, parseResult, saleUrl } from "./viva";

// Κεντρικό ταμείο (docs/design/spec-central-till-package-1.md, ύφος: docs/mockups/central-till/central-till-cosy.html):
// οθόνη πώλησης, επιλογές προϊόντος, μετρητά με ρέστα, καταστάσεις πληρωμής.

export default function App() {
  const t = dark; // το ταμείο είναι πάντα σκούρο (εγκεκριμένο ύφος)· δεν ακολουθεί το θέμα της συσκευής
  const [fontsReady, fontError] = useFonts({ InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold });
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = φορτώνει
  useEffect(() => void loadSession().then(setSession), []);
  const loading = session === undefined || (!fontsReady && !fontError); // χωρίς γραμματοσειρά δουλεύει με του συστήματος
  return (
    <SafeAreaProvider>
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="light" />
      {loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>
        : session ? <Till t={t} session={session} onUnpair={() => clearSession().then(() => clearPending()).then(() => setSession(null))} />
        : <Pair t={t} onPaired={setSession} />}
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const num = { fontVariant: ["tabular-nums" as const] };
const kinds = (n: number) => `${n} ${n === 1 ? "είδος" : "είδη"}`;
/** Κείμενο: μέγεθος, βάρος, χρώμα. Χωρίς το κενό πάνω/κάτω που βάζει το Android στις γραμματοσειρές. */
const ICON = { size: 18, strokeWidth: 1.75 };

function Button({ t, label, onPress, primary, disabled, flex }: { t: Theme; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; flex?: boolean }) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ minHeight: 48, flex: flex ? 1 : undefined, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: primary ? t.action : pressed ? t.raised : "transparent", borderWidth: primary ? 0 : 1, borderColor: t.line, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}
    >
      <Text style={[ty(14, "s", primary ? t.onAction : t.text), { textAlign: "center" }, num]}>{label}</Text>
    </Pressable>
  );
}

// Πιστοποίηση συσκευής: διεύθυνση της εφαρμογής + κωδικός σύζευξης μίας χρήσης από την κονσόλα.
function Pair({ t, onPaired }: { t: Theme; onPaired: (s: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState("https://");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [scan, setScan] = useState(false);
  const [permission, askPermission] = useCameraPermissions();
  const submit = async (url = baseUrl, c = code) => {
    setBusy(true);
    setError(undefined);
    try {
      const session = await pair(url.trim().replace(/\/$/, ""), c.trim().toUpperCase(), Platform.OS === "android" ? getAndroidId() : null);
      await saveSession(session); // το κλειδί μένει στο ασφαλές αποθετήριο της συσκευής
      onPaired(session);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Network request failed" ? e.message : "Δεν υπάρχει σύνδεση με αυτή τη διεύθυνση. Έλεγξέ την και δοκίμασε ξανά.");
    } finally {
      setBusy(false);
    }
  };
  const input = { ...ty(16, "m", t.text), minHeight: 48, borderRadius: 12, backgroundColor: t.panel, paddingHorizontal: 14 };
  const openScan = async () => {
    setError(undefined);
    if (!permission?.granted && !(await askPermission()).granted) { setError("Χωρίς πρόσβαση στην κάμερα. Γράψε τη διεύθυνση και τον κωδικό με το χέρι."); return; }
    setScan(true);
  };
  if (scan) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            const found = parsePairQr(data);
            if (!found) return; // άλλο QR στο κάδρο: συνεχίζει να ψάχνει
            setScan(false);
            setBaseUrl(found.baseUrl);
            setCode(found.code);
            void submit(found.baseUrl, found.code);
          }} />
        <View style={{ position: "absolute", left: 24, right: 24, bottom: 24, gap: 12, alignItems: "center" }}>
          <Text style={[ty(15, "m", "#fff"), { textAlign: "center" }]}>Στόχευσε το QR στη σελίδα «Ετοιμότητα» του σημείου, στην κονσόλα</Text>
          <Button t={t} label="Άκυρο" onPress={() => setScan(false)} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View style={{ width: "100%", maxWidth: 420, gap: 12 }}>
        <Text style={ty(18, "s", t.text)} accessibilityRole="header">Σύζευξη ταμείου</Text>
        <Text style={[ty(13, "r", t.muted), { lineHeight: 19 }]}>Σκάναρε το QR από τη σελίδα «Ετοιμότητα» του σημείου στην κονσόλα. Ισχύει 15 λεπτά.</Text>
        <Button t={t} primary label={busy ? "Έλεγχος…" : "Σκανάρισμα QR"} onPress={openScan} disabled={busy} />
        <Text style={[ty(13, "r", t.muted), { lineHeight: 19 }]}>Χωρίς κάμερα: γράψε τη διεύθυνση και τον 8ψήφιο κωδικό που φαίνεται κάτω από το QR.</Text>
        <TextInput style={input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://app.gelatosystem.app" placeholderTextColor={t.faint} accessibilityLabel="Διεύθυνση της εφαρμογής" />
        <TextInput style={[input, { letterSpacing: 4, fontFamily: font.s }]} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="ΚΩΔΙΚΟΣ" placeholderTextColor={t.faint} accessibilityLabel="Κωδικός σύζευξης" />
        {error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>! {error}</Text> : null}
        <Button t={t} label={busy ? "Έλεγχος…" : "Σύζευξη με κωδικό"} onPress={() => submit()} disabled={busy || code.trim().length !== 8} />
      </View>
    </View>
  );
}

// ---- Καταστάσεις πληρωμής: ένα component, όλες οι περιπτώσεις ----

type Status =
  | { kind: "waiting" }
  | { kind: "paid"; series: string | null; aa: number | null }
  | { kind: "unknown"; attempt: number; checkedAt: Date; noPaymentYet: boolean }
  | { kind: "failed" }
  | { kind: "unverified" }
  | { kind: "resume" }
  | { kind: "offline" }
  | { kind: "unpaired" }
  | { kind: "unpair" } // επιβεβαίωση: ο ταμίας βγάζει τη συσκευή από το ταμείο
  | { kind: "blocked"; message: string }
  | { kind: "cancel"; back: Status }; // επιβεβαίωση «ο πελάτης δεν πλήρωσε»· back = η οθόνη από την οποία ήρθε
type Tone = "neutral" | "ok" | "wait" | "bad";
type Action = { label: string; onPress: () => void; primary?: boolean };

const time = (d: Date | string) => new Date(d).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
// Κατάσταση = χρώμα + εικονίδιο + λέξη, ποτέ μόνο χρώμα.
const MARK: Record<Exclude<Tone, "neutral">, LucideIcon> = { ok: Check, wait: TriangleAlert, bad: TriangleAlert };

function StatusCard({ t, tone, label, title, text, note, actions, busy, summary }: { t: Theme; tone: Tone; label: string; title: string; text: string; note?: string; actions: Action[]; busy: boolean; summary?: string }) {
  const color = tone === "neutral" ? t.muted : t[tone];
  const Icon = tone === "neutral" ? null : MARK[tone];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: t.bg }}>
      {summary ? <Text style={[ty(13, "m", t.muted), { marginBottom: 12 }, num]}>{summary}</Text> : null}
      <View accessibilityLiveRegion={tone === "bad" ? "assertive" : "polite"} style={{ width: "100%", maxWidth: 480, backgroundColor: t.panel, borderRadius: 20, padding: 24, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", height: 26, paddingHorizontal: 10, borderRadius: 8, backgroundColor: tone === "neutral" ? t.raised : tint(color) }}>
          {Icon ? <Icon size={14} strokeWidth={2} color={color} /> : <ActivityIndicator size="small" color={t.muted} />}
          <Text style={ty(12, "s", color)}>{label}</Text>
        </View>
        <Text accessibilityRole="header" style={[ty(18, "s", t.text), num]}>{title}</Text>
        <Text style={[ty(13.5, "r", t.muted), { lineHeight: 20 }, num]}>{text}</Text>
        {note ? <Text style={[ty(12, "m", t.faint), num]}>{note}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          {actions.map((a) => <Button key={a.label} t={t} label={a.label} onPress={a.onPress} primary={a.primary} disabled={busy} />)}
        </View>
      </View>
    </View>
  );
}

function CashSheet({ t, totalCents, onContinue, onBack, back = "Πίσω στην πώληση", go = "Συνέχεια στο Viva Terminal για την απόδειξη" }: { t: Theme; totalCents: number; onContinue: () => void; onBack: () => void; back?: string; go?: string }) {
  const [given, setGiven] = useState("");
  const cents = amountCents(given);
  const missing = totalCents - cents;
  const row = (label: string, value: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={ty(13.5, "m", t.muted)}>{label}</Text><Text style={[ty(15, "s", t.text), num]}>{value}</Text></View>
  );
  const key = (k: string) => (
    <Pressable key={k} onPress={() => setGiven((g) => typeAmount(g, k))} accessibilityRole="button" accessibilityLabel={k === "⌫" ? "Σβήσιμο" : k === "," ? "Κόμμα" : k} style={({ pressed }) => ({ flex: 1, height: 56, borderRadius: 12, backgroundColor: pressed ? t.raised : t.card, alignItems: "center", justifyContent: "center" })}>
      <Text style={[ty(20, "s", t.text), num]}>{k}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, flexDirection: "row", padding: 24, gap: 24, justifyContent: "center" }}>
      <View style={{ flex: 1, maxWidth: 420, gap: 8 }}>
        <Text style={ty(13.5, "m", t.muted)}>Έδωσε ο πελάτης</Text>
        <Text style={[ty(34, "s", given ? t.text : t.faint), { marginBottom: 4 }, num]}>{given || "0"} €</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button t={t} flex label="Ακριβώς" onPress={() => setGiven(amountText(totalCents))} />
          {quickAmounts(totalCents).map((a) => <Button key={a} t={t} flex label={`${a / 100} €`} onPress={() => setGiven(amountText(a))} />)}
        </View>
        {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [",", "0", "⌫"]].map((r) => <View key={r[0]} style={{ flexDirection: "row", gap: 8 }}>{r.map(key)}</View>)}
      </View>
      <View style={{ flex: 1, maxWidth: 420, gap: 12, backgroundColor: t.panel, borderRadius: 20, padding: 24 }}>
        {row("Σύνολο", euro(totalCents))}
        {row("Έδωσε", euro(cents))}
        <View style={{ borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 12, gap: 4 }} accessibilityLiveRegion="polite">
          {missing > 0
            ? <Text style={[ty(16, "s", t.bad), num]}>! Λείπουν {euro(missing)}</Text>
            : <><Text style={ty(13.5, "m", t.muted)}>Ρέστα στον πελάτη</Text><Text style={[ty(34, "s", t.ok), num]}>{euro(-missing)}</Text></>}
        </View>
        <View style={{ flex: 1 }} />
        <Button t={t} primary label={go} onPress={onContinue} disabled={missing > 0} />
        <Button t={t} label={back} onPress={onBack} />
      </View>
    </View>
  );
}

// ---- Επιλογές προϊόντος ----

/** Γραμμή του καλαθιού. options: ids με τη σειρά που πατήθηκαν (η ίδια γεύση μπορεί δύο φορές). */
type CartLine = { key: string; productId: string; options: string[]; note: string; quantity: number };
const lineKey = (productId: string, options: readonly string[], note: string) => JSON.stringify([productId, [...options].sort(), note.trim()]);
type Draft = { product: Product; color: string; editKey?: string; options: string[]; note: string; quantity: number };

/** Ονόματα επιλογών για τη γραμμή: «2× Φιστίκι, Βανίλια, Χωρίς ζάχαρη», με τη σειρά των ομάδων. */
function optionsText(groups: readonly Group[], chosen: readonly string[]) {
  const parts: string[] = [];
  for (const g of groups) for (const o of g.options) {
    const n = chosen.filter((x) => x === o.id).length;
    if (n) parts.push(n > 1 ? `${n}× ${o.name}` : o.name);
  }
  return parts.join(", ");
}

const RULE: Record<Group["kind"], (g: Group) => string> = {
  REQUIRED: (g) => (g.pick > 1 ? `διάλεξε ${g.pick} · η ίδια μπορεί και δύο φορές` : "διάλεξε 1"),
  EXTRA: () => "προαιρετικά",
  REMOVE: () => "προαιρετικά, δεν αλλάζει η τιμή",
};

function OptionsSheet({ t, draft, setDraft, onDone, onClose }: { t: Theme; draft: Draft; setDraft: (d: Draft) => void; onDone: () => void; onClose: () => void }) {
  const { product, options, color } = draft;
  const missing = product.groups.reduce((n, g) => n + missingIn(g, options), 0);
  const unit = unitPrice(product.priceCents, product.groups, options);
  const extras = product.groups.flatMap((g) => (g.kind === "REMOVE" ? [] : g.options.flatMap((o) => (o.priceCents ? options.filter((x) => x === o.id).map(() => `${euro(o.priceCents).replace(" €", "")} ${o.name.toLowerCase()}`) : []))));
  return (
    <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(5,6,7,0.66)", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <View style={{ width: "100%", maxWidth: 860, maxHeight: "100%", backgroundColor: t.panel, borderRadius: 20, overflow: "hidden" }} accessibilityViewIsModal>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: t.divider }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: color, alignItems: "center", justifyContent: "center" }}><IceCreamCone {...ICON} color={t.ink} /></View>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={ty(18, "s", t.text)}>{product.name}</Text>
            <Text style={[ty(12.5, "m", t.muted), num]}>Βασική τιμή {euro(product.priceCents)}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Κλείσιμο χωρίς αλλαγές" style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}><X {...ICON} color={t.muted} /></Pressable>
        </View>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 24, gap: 24 }}>
          {product.groups.map((g, gi) => {
            const left = missingIn(g, options);
            return (
              <View key={g.id} style={{ gap: 10, ...(gi ? { borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 20 } : null) }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={ty(15, "s", t.text)}>{g.name}</Text>
                  <Text style={[ty(12.5, "m", t.muted), { flex: 1 }]}>{RULE[g.kind](g)}</Text>
                  {g.kind === "REQUIRED" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 8, backgroundColor: tint(left ? t.bad : t.ok) }} accessibilityLiveRegion="polite">
                      {left ? <TriangleAlert size={14} strokeWidth={2} color={t.bad} /> : <Check size={14} strokeWidth={2} color={t.ok} />}
                      <Text style={ty(12, "s", left ? t.bad : t.ok)}>{left ? `Λείπει ${left}` : "Έτοιμο"}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", margin: -4 }}>
                  {g.options.map((o) => {
                    const n = options.filter((x) => x === o.id).length;
                    const price = g.kind !== "REMOVE" && o.priceCents ? `+${euro(o.priceCents).replace(" €", "")}` : "";
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => setDraft({ ...draft, options: tapOption(options, g, o.id) })}
                        onLongPress={() => setDraft({ ...draft, options: dropOption(options, o.id) })}
                        accessibilityRole={g.kind === "REQUIRED" ? "button" : "checkbox"} accessibilityState={{ checked: n > 0 }}
                        accessibilityLabel={`${o.name}${price ? `, ${price} €` : ""}${n > 1 ? `, ${n} φορές` : ""}`} accessibilityHint={g.kind === "REQUIRED" && n ? "Παρατεταμένο πάτημα: βγαίνει μία" : undefined}
                        style={({ pressed }) => ({ width: "25%", borderWidth: 4, borderColor: t.panel, minHeight: 64, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: n ? color : pressed ? t.raised : t.card })}
                      >
                        <Text numberOfLines={2} style={[ty(14, n ? "s" : "m", n ? t.ink : t.text), { flex: 1 }]}>{o.name}</Text>
                        {price ? <Text style={[ty(12, "m", n ? t.ink : t.muted), { opacity: n ? 0.7 : 1 }, num]}>{price}</Text> : null}
                        {n > 1 ? <View style={{ position: "absolute", top: -7, right: -5, minWidth: 30, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: t.text, alignItems: "center", justifyContent: "center" }}><Text style={[ty(12, "b", t.bg), num]}>× {n}</Text></View> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
          <View style={{ gap: 10, ...(product.groups.length ? { borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 20 } : null) }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={ty(15, "s", t.text)}>Σημείωση</Text><Text style={ty(12.5, "m", t.muted)}>τυπώνεται στην απόδειξη</Text></View>
            <TextInput value={draft.note} onChangeText={(note) => setDraft({ ...draft, note })} maxLength={80} placeholder="π.χ. χωρίς κουτάλι" placeholderTextColor={t.faint} accessibilityLabel="Σημείωση γραμμής" style={{ ...ty(15, "m", t.text), minHeight: 48, borderRadius: 12, backgroundColor: t.card, paddingHorizontal: 14 }} />
          </View>
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: t.divider }}>
          <Stepper t={t} value={draft.quantity} label={product.name} onChange={(quantity) => setDraft({ ...draft, quantity: Math.max(1, quantity) })} />
          <Text numberOfLines={2} style={[ty(13, "m", t.muted), { flex: 1 }, num]}>{[euro(product.priceCents).replace(" €", ""), ...extras].join(" + ")}{draft.quantity > 1 ? `  × ${draft.quantity}` : ""}</Text>
          <Pressable onPress={onDone} disabled={missing > 0} accessibilityRole="button" accessibilityState={{ disabled: missing > 0 }} style={{ width: 260, height: 56, borderRadius: 28, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: missing ? t.raised : t.action }}>
            <Text style={ty(15, "s", missing ? t.faint : t.onAction)}>{missing ? `Λείπουν ${missing}` : draft.editKey ? "Ενημέρωση" : "Προσθήκη"}</Text>
            <Text style={[ty(15, "s", missing ? t.faint : t.onAction), num]}>{euro(unit * draft.quantity)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Stepper({ t, value, label, onChange, ink }: { t: Theme; value: number; label: string; onChange: (n: number) => void; ink?: boolean }) {
  const c = ink ? t.ink : t.text;
  const b = ({ pressed }: { pressed: boolean }) => ({ width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const, opacity: pressed ? 0.6 : 1 });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: ink ? "rgba(18,20,23,0.25)" : t.line }}>
      <Pressable onPress={() => onChange(value - 1)} accessibilityRole="button" accessibilityLabel={`Ένα λιγότερο ${label}`} style={b}><Text style={ty(20, "s", c)}>−</Text></Pressable>
      <Text style={[ty(15, "b", c), { minWidth: 22, textAlign: "center" }, num]}>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)} accessibilityRole="button" accessibilityLabel={`Ένα ακόμη ${label}`} style={b}><Text style={ty(20, "s", c)}>+</Text></Pressable>
    </View>
  );
}

// Εικονίδιο κατηγορίας από το όνομα· ό,τι δεν αναγνωρίζεται παίρνει ετικέτα.
const CAT_ICONS: [RegExp, LucideIcon][] = [[/παγωτ|χωνά|κύπελ/i, IceCreamCone], [/γραν|χυμ|smooth|ρόφ|αναψ/i, CupSoda], [/καφ|coffee|espresso/i, Coffee], [/γλυκ|κέικ|τούρτ|βάφλ|κρέπ/i, CakeSlice]];
const catIcon = (name: string) => CAT_ICONS.find(([re]) => re.test(name))?.[1] ?? Tag;

/** Τρόπος πληρωμής (μετρητά / κάρτα): ίδιο στην πώληση, στον λογαριασμό και στο μοίρασμα. */
function Methods({ t, methods, method, setMethodId }: { t: Theme; methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Τρόπος πληρωμής" style={{ flexDirection: "row", gap: 6 }}>
      {methods.map((m) => {
        const on = m.id === method?.id;
        const Icon = m.code === "cash" ? Banknote : CreditCard;
        return (
          <Pressable key={m.id} onPress={() => setMethodId(m.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flex: 1, height: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: on ? t.action : "transparent", borderWidth: 1, borderColor: on ? t.action : t.line }}>
            <Icon {...ICON} color={on ? t.onAction : t.muted} />
            <Text style={ty(12.5, "s", on ? t.onAction : t.muted)}>{m.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Το κουμπί που χρεώνει: κείμενο αριστερά, ποσό δεξιά. */
function PayButton({ t, label, cents, onPress, disabled }: { t: Theme; label: string; cents: number; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
      style={({ pressed }) => ({ height: 56, borderRadius: 28, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: disabled ? 0.35 : pressed ? 0.85 : 1 })}>
      <Text style={ty(16, "s", t.onAction)}>{label}</Text>
      <Text style={[ty(16, "b", t.onAction), num]}>{euro(cents)}</Text>
    </Pressable>
  );
}

// ---- Τραπέζια και λογαριασμοί (κουβάς) ----
// Ύφος: docs/mockups/central-till/central-till-tables-orders.html, καρέ 1–2. Γαλάζιο = ανοιχτό, διακεκομμένο = ελεύθερο.

const since = (from: string, now: Date) => {
  const m = Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 60000));
  return m < 60 ? `${m}'` : `${Math.floor(m / 60)} ώ ${String(m % 60).padStart(2, "0")}'`;
};
/** «2× Φιστίκι, Βανίλια» από τις επιλογές που κράτησε ο server στη γραμμή. */
const billOpts = (o: BillLine["options"]) => {
  const n = new Map<string, number>();
  for (const x of o ?? []) n.set(x.name, (n.get(x.name) ?? 0) + 1);
  return [...n].map(([name, c]) => (c > 1 ? `${c}× ${name}` : name)).join(", ");
};
/** Σφάλμα του server → κείμενο για τον ταμία. 401 το χειρίζεται ο καλών. */
const failText = (e: unknown) => {
  const err = e instanceof ApiError ? e : new ApiError(0, "network", "");
  if (err.status === 0) return "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά.";
  return err.message || "Κάτι πήγε στραβά. Δοκίμασε ξανά.";
};
const unpairedBy = (e: unknown) => e instanceof ApiError && e.status === 401;

function Tables({ t, session, now, width, onOpen, onReservations, onUnpaired }: { t: Theme; session: Session; now: Date; width: number; onOpen: (id: string) => void; onReservations: () => void; onUnpaired: () => void }) {
  const [data, setData] = useState<{ tables: DiningTable[]; bills: BillSummary[] }>();
  const [res, setRes] = useState<Reservation[]>([]);
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState<string>();
  // οι κρατήσεις είναι συμπληρωματικές: αν αποτύχουν, η κάτοψη δουλεύει κανονικά
  const load = useCallback(() => Promise.all([getBills(session), getDay(session, isoDay(new Date())).catch(() => null)]).then(([d, r]) => { setData(d); if (r) setRes(r.reservations); setError(undefined); }, (e) => (unpairedBy(e) ? onUnpaired() : setError(failText(e)))), [session, onUnpaired]);
  // Οι σερβιτόροι και τα άλλα ταμεία αλλάζουν την κάτοψη: ανανέωση κάθε 15''.
  useEffect(() => { void load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  const open = async (tableId: string) => {
    setOpening(tableId);
    try { onOpen((await openBill(session, { tableId })).id); } catch (e) { if (unpairedBy(e)) onUnpaired(); else setError(failText(e)); } finally { setOpening(undefined); }
  };

  if (!data) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>{error ? <><Text style={ty(14, "m", t.bad)}>! {error}</Text><Button t={t} label="Δοκίμασε ξανά" onPress={load} /></> : <ActivityIndicator color={t.muted} />}</View>;

  const byTable = new Map(data.bills.filter((b) => b.tableId).map((b) => [b.tableId!, b]));
  const nextRes = nextByTable(res);
  const booked = res.filter((r) => r.status === "BOOKED").length;
  const loose = data.bills.filter((b) => !b.tableId);
  const zones = [...new Set(data.tables.map((x) => x.zone ?? "Χωρίς ζώνη"))];
  const due = data.bills.reduce((s, b) => s + b.dueCents - b.heldCents, 0);
  const cols = Math.max(3, Math.min(6, Math.floor((width + 12) / 176)));
  const tileW = (width - 12 * (cols - 1)) / cols;

  // Κράτηση: μοβ περίγραμμα όταν έρχονται μέσα στην ώρα (ή αργούν), διακεκομμένο όταν είναι αργότερα (mockup reservations.html, καρέ 1)
  const tile = (key: string, name: string, b: BillSummary | undefined, onPress: () => void, r?: Reservation) => {
    const mins = r ? (new Date(r.startsAt).getTime() - now.getTime()) / 60000 : Infinity;
    const soon = !b && mins <= 60;
    const rc = t.categories[1];
    return (
    <Pressable key={key} onPress={onPress} disabled={!!opening} accessibilityRole="button"
      accessibilityLabel={[b ? `${name}, ανοιχτό, χρωστάει ${euro(b.dueCents - b.heldCents)}` : r ? `${name}, κράτηση` : `${name}, ελεύθερο, πάτα για νέο λογαριασμό`, r ? `${hhmm(r.startsAt)} ${r.name}, ${r.guests} άτομα, ${untilText(r.startsAt, now)}` : ""].filter(Boolean).join(". ")}
      style={({ pressed }) => ({ width: tileW, height: 132, borderRadius: 14, padding: 12, opacity: pressed ? 0.85 : 1, backgroundColor: b ? t.categories[4] : soon ? tint(rc) : "transparent", borderWidth: b ? 0 : 1, borderStyle: soon ? "solid" : "dashed", borderColor: b ? "transparent" : r ? rc : t.raised })}>
      <Text numberOfLines={1} style={ty(22, "b", b ? t.ink : r ? rc : t.faint)}>{name}</Text>
      {b ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}><Clock size={13} strokeWidth={2} color={t.ink} style={{ opacity: 0.6 }} /><Text numberOfLines={1} style={[ty(12.5, "m", t.ink), { opacity: 0.7, flex: 1 }, num]}>{[b.openedByName, since(b.openedAt, now)].filter(Boolean).join(" · ")}</Text></View> : null}
      {r ? <Text numberOfLines={1} style={[ty(12.5, "s", b ? "#3D3F8F" : rc), { marginTop: 4 }, num]}>{hhmm(r.startsAt)} · {r.name} · {r.guests}</Text> : null}
      <View style={{ marginTop: "auto", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {b ? <Text style={[ty(18, "b", t.ink), num]}>{euro(b.dueCents - b.heldCents)}</Text>
          : <Text style={[ty(13, r ? "s" : "m", mins < -10 ? t.wait : r ? rc : t.faint), num]}>{opening === key ? "Ανοίγει…" : !r ? "Ελεύθερο" : mins < -10 ? `Δεν ήρθαν · ${untilText(r.startsAt, now)}` : soon ? `Κράτηση ${untilText(r.startsAt, now)}` : "Κράτηση"}</Text>}
        {b?.pendingCents ? <Text style={[ty(11.5, "s", t.ink), { opacity: 0.7 }]}>πληρώνεται</Text> : null}
      </View>
    </Pressable>
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 20, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
        <Text accessibilityRole="header" style={ty(20, "s", t.text)}>Τραπέζια</Text>
        <Text style={[ty(13, "m", t.muted), num]}>{data.bills.length} ανοιχτά · {euro(due)}{booked ? ` · ${booked} ${booked === 1 ? "κράτηση" : "κρατήσεις"} σήμερα` : ""}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        {[[t.categories[4], "Ανοιχτό· πάτα για τον λογαριασμό"], ["transparent", "Ελεύθερο· πάτα για νέο λογαριασμό"]].map(([c, l]) => (
          <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c, borderWidth: 1, borderStyle: "dashed", borderColor: c === "transparent" ? t.faint : c }} /><Text style={ty(12.5, "m", t.muted)}>{l}</Text></View>
        ))}
      </View>
      {error ? <Text accessibilityLiveRegion="assertive" style={ty(13, "m", t.bad)}>! {error}</Text> : null}
      {data.tables.length === 0 ? <Text style={[ty(13.5, "m", t.muted), { lineHeight: 20 }]}>Το κατάστημα δεν έχει τραπέζια. Πρόσθεσέ τα από την κονσόλα.</Text> : null}
      {zones.map((z) => (
        <View key={z} style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 14 }}>
          <Text style={ty(13.5, "s", t.muted)}>{z}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {data.tables.filter((x) => (x.zone ?? "Χωρίς ζώνη") === z).map((x) => { const b = byTable.get(x.id); const r = nextRes.get(x.id); const due = r && !b && new Date(r.startsAt).getTime() - now.getTime() <= 3_600_000;
              // τραπέζι που περιμένει κράτηση μέσα στην ώρα: πάμε στην κράτηση («Ήρθαν»), όχι σε νέο λογαριασμό
              return tile(x.id, x.name, b, () => (b ? onOpen(b.id) : due ? onReservations() : void open(x.id)), r); })}
          </View>
        </View>
      ))}
      {loose.length ? (
        <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 14 }}>
          <Text style={ty(13.5, "s", t.muted)}>Χωρίς τραπέζι</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{loose.map((b) => tile(b.id, b.label ?? "Λογαριασμός", b, () => onOpen(b.id)))}</View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const VOID_REASONS = ["Λάθος παραγγελία", "Το άλλαξε ο πελάτης"];

type Split = "items" | "amount" | null;

function BillView({ t, session, id, now, methods, method, setMethodId, busy, split, setSplit, people, setPeople, onBack, onAdd, onPay, onShare, onUnpaired }: {
  t: Theme; session: Session; id: string; now: Date; methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void; busy: boolean;
  split: Split; setSplit: (s: Split) => void; people: number; setPeople: (n: number) => void;
  onBack: () => void; onAdd: (title: string) => void; onPay: (b: Bill, title: string, pick?: Pick) => void; onShare: (b: Bill, title: string, cents: number) => void; onUnpaired: () => void;
}) {
  const [bill, setBill] = useState<Bill>();
  const [error, setError] = useState<string>();
  const [voiding, setVoiding] = useState<string>();
  const [working, setWorking] = useState(false);
  const fail = useCallback((e: unknown) => (unpairedBy(e) ? onUnpaired() : setError(failText(e))), [onUnpaired]);
  const load = useCallback(() => getBill(session, id).then((b) => { setBill(b); setError(undefined); }, fail), [session, id, fail]);
  useEffect(() => { void load(); }, [load]);

  const act = async (f: () => Promise<unknown>, after?: () => void) => {
    setWorking(true);
    try { await f(); setVoiding(undefined); if (after) after(); else await load(); } catch (e) { fail(e); } finally { setWorking(false); }
  };

  if (!bill) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>{error ? <><Text style={ty(14, "m", t.bad)}>! {error}</Text><Button t={t} label="Δοκίμασε ξανά" onPress={load} /><Button t={t} label="Πίσω στα τραπέζια" onPress={onBack} /></> : <ActivityIndicator color={t.muted} />}</View>;

  const title = bill.table ? `Τραπέζι ${bill.table.name}` : bill.label ?? "Λογαριασμός";
  const open = bill.status === "OPEN";
  const sub = [bill.table?.zone, bill.openedByName, `από ${time(bill.openedAt)} (${since(bill.openedAt, now)})`, bill.guests ? `${bill.guests} άτομα` : null].filter(Boolean).join(" · ");
  const voided = bill.lines.filter((l) => l.voidedAt).length;
  const empty = bill.totalCents === 0 && bill.paidCents === 0;
  const row = (label: string, value: string, color = t.muted) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={ty(13, "m", color)}>{label}</Text><Text style={[ty(13, "s", color === t.muted ? t.text : color), num]}>{value}</Text></View>
  );

  return (
    <View style={{ flex: 1, paddingTop: 20, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 }}>
        <Pressable onPress={split ? () => setSplit(null) : onBack} accessibilityRole="button" accessibilityLabel={split ? "Πίσω στον λογαριασμό" : "Πίσω στα τραπέζια"} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}><ArrowLeft {...ICON} color={t.text} /></Pressable>
        <Text accessibilityRole="header" style={ty(20, "s", t.text)}>{split && open ? `Μοίρασμα · ${title}` : title}</Text>
        <Text numberOfLines={1} style={[ty(13, "m", t.muted), { flex: 1 }, num]}>{split && open ? `${bill.items} είδη · ${euro(bill.totalCents)}` : sub}</Text>
        {open && !split ? <Pressable onPress={() => onAdd(title)} accessibilityRole="button" style={({ pressed }) => ({ height: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.raised : "transparent" })}><Plus {...ICON} color={t.text} /><Text style={ty(14, "s", t.text)}>Προσθήκη</Text></Pressable> : null}
      </View>

      {split === "items" && open ? <SplitBody t={t} bill={bill} title={title} methods={methods} method={method} setMethodId={setMethodId} busy={busy} onPay={(pick) => onPay(bill, title, pick)} />
      : split === "amount" && open ? <AmountBody t={t} bill={bill} methods={methods} method={method} setMethodId={setMethodId} busy={busy} people={people} setPeople={setPeople} onShare={(c) => onShare(bill, title, c)} onPay={() => onPay(bill, title)} />
      : (
      <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 16 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
          {bill.rounds.length === 0 ? <Text style={[ty(13.5, "m", t.muted), { lineHeight: 20 }]}>Ο λογαριασμός είναι άδειος. Πάτα «Προσθήκη» για την πρώτη παραγγελία.</Text> : null}
          {bill.rounds.map((r) => (
            <View key={r.id} style={{ backgroundColor: t.panel, borderRadius: 14, paddingVertical: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Text style={ty(14, "s", t.text)}>Αποστολή {r.number}</Text>
                <Text style={[ty(12.5, "m", t.muted), num]}>{[time(r.sentAt), r.sentByName].filter(Boolean).join(" · ")}</Text>
              </View>
              {bill.lines.filter((l) => l.roundId === r.id).map((l) => {
                const gone = !!l.voidedAt;
                const opts = billOpts(l.options);
                const asking = voiding === l.id;
                const fg = gone ? t.faint : t.text;
                return (
                  <Pressable key={l.id} onPress={() => setVoiding(asking ? undefined : l.id)} disabled={!open || !l.canVoid} accessibilityRole="button" accessibilityHint={open && l.canVoid ? "Ακύρωση γραμμής" : undefined}
                    style={{ borderTopWidth: 1, borderTopColor: t.divider, paddingHorizontal: 14, paddingVertical: 10, gap: 3, backgroundColor: asking ? t.card : "transparent" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={[ty(14, "s", fg), { minWidth: 20 }, num]}>{l.quantity}</Text>
                      <Text numberOfLines={2} style={[ty(14, "s", fg), { flex: 1, textDecorationLine: gone ? "line-through" : "none" }]}>{l.name}</Text>
                      {l.paid ? <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 7, backgroundColor: tint(t.ok), justifyContent: "center" }}><Text style={[ty(11.5, "s", t.ok), num]}>{l.paid === l.quantity ? "Πληρώθηκε" : `Πληρώθηκαν ${l.paid}`}</Text></View> : null}
                      <Text style={[ty(14, "s", fg), num, { textDecorationLine: gone ? "line-through" : "none" }]}>{euro(l.unitPriceCents * l.quantity)}</Text>
                    </View>
                    {opts || l.note ? <Text style={[ty(12.5, "m", t.muted), { marginLeft: 30 }]}>{[opts, l.note && `Σημείωση: ${l.note}`].filter(Boolean).join(" · ")}</Text> : null}
                    {gone ? <Text style={[ty(12.5, "m", t.faint), { marginLeft: 30 }]}>Ακυρώθηκε {time(l.voidedAt!)}{l.voidReason ? ` · ${l.voidReason}` : ""}</Text> : null}
                    {asking ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8, marginLeft: 30 }}>
                        <Text style={ty(13, "m", t.muted)}>Ακύρωση γιατί:</Text>
                        {VOID_REASONS.map((reason) => <Button key={reason} t={t} label={reason} disabled={working} onPress={() => void act(() => voidBillLine(session, bill.id, l.id, reason))} />)}
                        <Button t={t} label="Όχι" onPress={() => setVoiding(undefined)} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>

        <View style={{ width: 348, backgroundColor: t.panel, borderRadius: 16, padding: 16, gap: 10 }}>
          {row("Αποστολές", `${bill.rounds.length}${voided ? ` (${voided} ${voided === 1 ? "ακύρωση" : "ακυρώσεις"})` : ""}`)}
          {row("Είδη", String(bill.items))}
          {bill.paidCents ? row("Πληρώθηκε ήδη", euro(bill.paidCents), t.ok) : null}
          {bill.heldCents ? row(`Εισπράχθηκαν μερίδια (${bill.shares.filter((x) => x.status === "PAID").length})`, euro(bill.heldCents), t.ok) : null}
          {bill.pendingCents ? row("Πληρώνεται τώρα", euro(bill.pendingCents), t.wait) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 10 }}>
            <Text style={ty(15, "s", t.text)}>{open ? "Χρωστάει" : bill.status === "SETTLED" ? "Εξοφλήθηκε" : "Ακυρώθηκε"}</Text>
            <Text style={[ty(30, "b", t.text), { letterSpacing: -0.5 }, num]}>{euro(open ? bill.dueCents - bill.heldCents : bill.paidCents)}</Text>
          </View>
          {bill.pendingCents ? <Text style={[ty(12.5, "m", t.muted), { lineHeight: 18, backgroundColor: t.card, borderRadius: 12, padding: 12 }]}>Μια πληρωμή αυτού του λογαριασμού είναι σε εξέλιξη σε κάποιο ταμείο. Τα είδη της δεν ξαναχρεώνονται.</Text> : null}
          {!open ? <Text style={[ty(12.5, "m", t.muted), { lineHeight: 18 }]}>Ο λογαριασμός έκλεισε {bill.closedAt ? time(bill.closedAt) : ""}.</Text> : null}
          {error ? <Text accessibilityLiveRegion="assertive" style={[ty(13, "m", t.bad), { lineHeight: 18 }]}>! {error}</Text> : null}
          <View style={{ flex: 1 }} />
          {open && empty ? <Button t={t} label="Κλείσιμο χωρίς πληρωμή" disabled={working} onPress={() => void act(() => cancelBill(session, bill.id, "Χωρίς παραγγελία"), onBack)} /> : null}
          {open && !empty ? (
            <>
              {bill.heldCents ? <Text style={[ty(12.5, "m", t.muted), { lineHeight: 18 }]}>Ο λογαριασμός μοιράζεται κατά ποσό. Η απόδειξη βγαίνει με το υπόλοιπο και γράφει όλες τις πληρωμές.</Text> : null}
              {bill.dueCents > 1 ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {!bill.heldCents && bill.lines.reduce((n, l) => n + l.remaining, 0) > 1 ? <Button t={t} flex label="Ανά είδη" disabled={busy || working || !!bill.pendingCents} onPress={() => setSplit("items")} /> : null}
                  <Button t={t} flex label={bill.heldCents ? "Συνέχεια μοιράσματος" : "Κατά ποσό"} disabled={busy || working || !!bill.pendingCents} onPress={() => { if (!bill.heldCents) setPeople(Math.min(6, Math.max(2, bill.guests ?? 2))); setSplit("amount"); }} />
                </View>
              ) : null}
              <Methods t={t} methods={methods} method={method} setMethodId={setMethodId} />
              <PayButton t={t} label={busy ? "Περίμενε…" : bill.heldCents ? "Πληρωμή υπολοίπου" : "Πληρωμή όλου"} cents={bill.dueCents - bill.heldCents} onPress={() => onPay(bill, title)} disabled={busy || working || !bill.dueCents || !method || bill.shares.some((x) => x.status === "PENDING")} />
            </>
          ) : null}
          {!open ? <Button t={t} primary label="Πίσω στα τραπέζια" onPress={onBack} /> : null}
        </View>
      </View>
      )}
    </View>
  );
}

/** Μια απόδειξη του μοιράσματος: ποιες γραμμές, πόσα τεμάχια, ποσό. */
type Pick = { lines: BillPick[]; cents: number; items: number };

// Μοίρασμα ανά είδη (docs/mockups/central-till/central-till-split.html): τσεκάρεις ό,τι πληρώνει ένας πελάτης, ή μέρος
// μιας γραμμής («1 από 3»), και εισπράττεις. Κάθε πελάτης παίρνει δική του απόδειξη· ό,τι μένει περιμένει τον επόμενο.
function SplitBody({ t, bill, title, methods, method, setMethodId, busy, onPay }: {
  t: Theme; bill: Bill; title: string; methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void; busy: boolean; onPay: (pick: Pick) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const due = bill.lines.filter((l) => l.remaining > 0);
  const picked = due.filter((l) => chosen[l.id]).map((l) => ({ l, q: Math.min(chosen[l.id], l.remaining) }));
  const sums = totals(picked.map(({ l, q }) => ({ priceCents: l.unitPriceCents, vatRate: l.vatRate, quantity: q })));
  const items = picked.reduce((n, p) => n + p.q, 0);
  const n = bill.sales.length + 1;
  const set = (id: string, q: number) => setChosen((c) => ({ ...c, [id]: q }));
  const allChosen = due.length > 0 && due.every((l) => chosen[l.id] === l.remaining);
  // Η μπάρα: πληρωμένα, αυτή η απόδειξη, ό,τι μένει. Με το ποσό γραμμένο, όχι μόνο με χρώμα.
  const pct = (c: number) => `${bill.totalCents ? (c / bill.totalCents) * 100 : 0}%` as const;
  const left = bill.dueCents - sums.totalCents;

  return (
    <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 16 }}>
      <View style={{ flex: 1, gap: 12 }}>
        <View style={{ backgroundColor: t.panel, borderRadius: 14, padding: 14, gap: 10 }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={[ty(14, "s", t.text), num]}>Πληρώθηκαν {euro(bill.paidCents)} από {euro(bill.totalCents)}</Text>
            <Text style={[ty(13, "m", t.muted), num]}>Μένουν {euro(bill.dueCents)}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.raised, flexDirection: "row", overflow: "hidden", gap: 2 }}>
            {bill.paidCents ? <View style={{ width: pct(bill.paidCents), backgroundColor: t.ok }} /> : null}
            {sums.totalCents ? <View style={{ width: pct(sums.totalCents), backgroundColor: t.action }} /> : null}
          </View>
          <View style={{ flexDirection: "row", gap: 14 }}>
            {[[t.ok, "Πληρώθηκαν"], [t.action, "Αυτή η απόδειξη"], [t.raised, "Μένουν"]].map(([c, l]) => (
              <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c }} /><Text style={ty(12.5, "m", t.muted)}>{l}</Text></View>
            ))}
          </View>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
          {due.map((l) => {
            const q = chosen[l.id] ?? 0;
            const on = q > 0;
            const opts = billOpts(l.options);
            const fg = on ? t.ink : t.text;
            return (
              <Pressable key={l.id} onPress={() => set(l.id, on ? 0 : l.remaining)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                accessibilityLabel={`${l.name}${l.remaining > 1 ? `, ${q || l.remaining} από ${l.remaining}` : ""}, ${euro(l.unitPriceCents * (q || l.remaining))}`}
                style={{ minHeight: 64, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: on ? t.categories[1] : t.card }}>
                {on && l.remaining > 1 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "rgba(18,20,23,0.25)" }}>
                    <Pressable onPress={() => set(l.id, q - 1)} accessibilityRole="button" accessibilityLabel={`Ένα λιγότερο ${l.name}`} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Text style={ty(20, "s", t.ink)}>−</Text></Pressable>
                    <Text style={[ty(14, "s", t.ink), num]}>{q} από {l.remaining}</Text>
                    <Pressable onPress={() => set(l.id, Math.min(l.remaining, q + 1))} disabled={q >= l.remaining} accessibilityRole="button" accessibilityLabel={`Ένα ακόμη ${l.name}`} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: q >= l.remaining ? 0.3 : 1 }}><Text style={ty(20, "s", t.ink)}>+</Text></Pressable>
                  </View>
                ) : (
                  <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: on ? t.ink : t.faint, backgroundColor: on ? t.ink : "transparent", alignItems: "center", justifyContent: "center" }}>{on ? <Check size={16} strokeWidth={2.5} color={t.categories[1]} /> : null}</View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={ty(14.5, "s", fg)}>{l.remaining > 1 && !on ? `${l.remaining}× ` : ""}{l.name}</Text>
                  {opts || l.remaining > 1 ? <Text numberOfLines={1} style={[ty(12.5, "m", fg), { opacity: on ? 0.7 : 0.75 }, num]}>{[opts, l.remaining > 1 ? `${euro(l.unitPriceCents)} το ένα` : ""].filter(Boolean).join(" · ")}</Text> : null}
                </View>
                <Text style={[ty(14.5, "s", fg), num]}>{euro(l.unitPriceCents * (q || l.remaining))}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ width: 348, backgroundColor: t.panel, borderRadius: 16, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text accessibilityRole="header" style={ty(16, "s", t.text)}>Απόδειξη {n}</Text>
          <Button t={t} label={allChosen ? "Καθαρισμός" : "Όλα όσα μένουν"} onPress={() => setChosen(allChosen ? {} : Object.fromEntries(due.map((l) => [l.id, l.remaining])))} />
        </View>
        {bill.sales.map((x) => (
          <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: t.card }}>
            <Check size={14} strokeWidth={2} color={t.ok} />
            <Text style={[ty(12.5, "s", t.text), { flex: 1 }, num]}>Πληρώθηκε απόδειξη {[x.series, x.aa].filter((v) => v != null).join(" ")}</Text>
            <Text style={[ty(12.5, "s", t.text), num]}>{euro(x.totalCents)}</Text>
          </View>
        ))}
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 4 }}>
          {picked.length === 0 ? <Text style={[ty(13, "m", t.muted), { lineHeight: 19 }]}>Τσέκαρε ό,τι πληρώνει αυτός ο πελάτης. Τα υπόλοιπα μένουν για τον επόμενο.</Text> : null}
          {picked.map(({ l, q }) => (
            <View key={l.id} style={{ flexDirection: "row", gap: 8 }}>
              <Text numberOfLines={1} style={[ty(13, "m", t.text), { flex: 1 }]}>{l.name}{q > 1 ? ` × ${q}` : ""}</Text>
              <Text style={[ty(13, "m", t.text), num]}>{euro(l.unitPriceCents * q)}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={{ flex: 1 }} />
        <View style={{ borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={ty(13, "m", t.muted)}>Καθαρή αξία · ΦΠΑ</Text><Text style={[ty(13, "m", t.muted), num]}>{euro(sums.netCents)} · {euro(sums.vatCents)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 8 }}><Text style={ty(15, "s", t.text)}>Απόδειξη {n}</Text><Text style={[ty(28, "b", t.text), { letterSpacing: -0.5 }, num]}>{euro(sums.totalCents)}</Text></View>
          {picked.length ? <Text style={[ty(12.5, "m", t.muted), num]}>{left > 0 ? `Μετά μένουν ${euro(left)} για τον επόμενο` : `Με αυτήν κλείνει ο λογαριασμός του ${title.replace("Τραπέζι", "τραπεζιού")}`}</Text> : null}
        </View>
        <Methods t={t} methods={methods} method={method} setMethodId={setMethodId} />
        <PayButton t={t} label={busy ? "Περίμενε…" : `Είσπραξη απόδειξης ${n}`} cents={sums.totalCents} disabled={busy || !picked.length || !method}
          onPress={() => onPay({ lines: picked.map(({ l, q }) => ({ lineId: l.id, quantity: q })), cents: sums.totalCents, items })} />
      </View>
    </View>
  );
}

// Μοίρασμα κατά ποσό (Viva: «payment protocol» ανά μερίδιο, μία απόδειξη στο τέλος με όλες τις πληρωμές). «Ίσα σε N» για
// όσους μένουν ή άλλο ποσό. Το τελευταίο μερίδιο είναι η απόδειξη· τα προηγούμενα εισπράττονται χωρίς χαρτί.
function AmountBody({ t, bill, methods, method, setMethodId, busy, people, setPeople, onShare, onPay }: {
  t: Theme; bill: Bill; methods: PaymentMethod[]; method?: PaymentMethod; setMethodId: (id: string) => void; busy: boolean;
  people: number; setPeople: (n: number) => void; onShare: (cents: number) => void; onPay: () => void;
}) {
  const [typed, setTyped] = useState("");
  const left = bill.dueCents - bill.heldCents;
  const paid = bill.shares.filter((x) => x.status === "PAID");
  const inTerminal = bill.shares.some((x) => x.status === "PENDING");
  const cents = typed ? amountCents(typed) : equalSplit(left, Math.max(1, people))[0];
  const last = cents === left;
  const over = cents > left;
  const k = paid.length + 1;
  const pct = (c: number) => `${bill.totalCents ? (c / bill.totalCents) * 100 : 0}%` as const;
  const done = bill.paidCents + bill.heldCents;

  const chip = (n: number) => {
    const on = !typed && people === n;
    return (
      <Pressable key={n} onPress={() => { setTyped(""); setPeople(n); }} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`Ίσα σε ${n}, ${euro(equalSplit(left, n)[0])} ο καθένας`}
        style={({ pressed }) => ({ flex: 1, minHeight: 64, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: on ? t.action : pressed ? t.raised : t.card })}>
        <Text style={[ty(18, "b", on ? t.onAction : t.text), num]}>{n}</Text>
        <Text style={[ty(12, "m", on ? t.onAction : t.muted), num]}>{euro(equalSplit(left, n)[0])}</Text>
      </Pressable>
    );
  };
  const key = (x: string) => (
    <Pressable key={x} onPress={() => setTyped((g) => typeAmount(g, x))} accessibilityRole="button" accessibilityLabel={x === "⌫" ? "Σβήσιμο" : x === "," ? "Κόμμα" : x} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 12, backgroundColor: pressed ? t.raised : t.card, alignItems: "center", justifyContent: "center" })}>
      <Text style={[ty(19, "s", t.text), num]}>{x}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 16 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
        <View style={{ backgroundColor: t.panel, borderRadius: 14, padding: 14, gap: 10 }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={[ty(14, "s", t.text), num]}>Πληρώθηκαν {euro(done)} από {euro(bill.totalCents)}</Text>
            <Text style={[ty(13, "m", t.muted), num]}>Μένουν {euro(left)}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.raised, flexDirection: "row", overflow: "hidden", gap: 2 }}>
            {done ? <View style={{ width: pct(done), backgroundColor: t.ok }} /> : null}
            {cents && !over ? <View style={{ width: pct(cents), backgroundColor: t.action }} /> : null}
          </View>
          <View style={{ flexDirection: "row", gap: 14 }}>
            {[[t.ok, "Πληρώθηκαν"], [t.action, "Αυτό το μερίδιο"], [t.raised, "Μένουν"]].map(([c, l]) => (
              <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c }} /><Text style={ty(12.5, "m", t.muted)}>{l}</Text></View>
            ))}
          </View>
        </View>

        <View style={{ backgroundColor: t.panel, borderRadius: 14, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Divide {...ICON} color={t.muted} />
            <Text style={ty(14, "s", t.text)}>Ίσα σε όσους μένουν</Text>
          </View>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8 }}>{[1, 2, 3, 4, 5, 6].map(chip)}</View>
        </View>

        <View style={{ backgroundColor: t.panel, borderRadius: 14, padding: 14, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            <Text style={ty(14, "s", t.text)}>Άλλο ποσό</Text>
            <Text style={[ty(22, "s", typed ? (over ? t.bad : t.text) : t.faint), num]}>{typed || "0"} €</Text>
          </View>
          {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [",", "0", "⌫"]].map((r) => <View key={r[0]} style={{ flexDirection: "row", gap: 8 }}>{r.map(key)}</View>)}
        </View>
      </ScrollView>

      <View style={{ width: 348, backgroundColor: t.panel, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text accessibilityRole="header" style={ty(16, "s", t.text)}>{last ? "Τελευταίο μερίδιο · απόδειξη" : `Μερίδιο ${k}`}</Text>
        {bill.sales.map((x) => (
          <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: t.card }}>
            <Check size={14} strokeWidth={2} color={t.ok} />
            <Text style={[ty(12.5, "s", t.text), { flex: 1 }, num]}>Πληρώθηκε απόδειξη {[x.series, x.aa].filter((v) => v != null).join(" ")}</Text>
            <Text style={[ty(12.5, "s", t.text), num]}>{euro(x.totalCents)}</Text>
          </View>
        ))}
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 6 }}>
          {bill.shares.length === 0 ? <Text style={[ty(13, "m", t.muted), { lineHeight: 19 }]}>Κάθε πελάτης πληρώνει το μερίδιό του με κάρτα ή μετρητά. Με το τελευταίο βγαίνει μία απόδειξη για όλο τον λογαριασμό.</Text> : null}
          {bill.shares.map((x, i) => {
            const Icon = x.status === "PENDING" ? Clock : x.cash ? Banknote : CreditCard;
            return (
              <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: t.card }}>
                <Icon size={15} strokeWidth={1.75} color={x.status === "PENDING" ? t.wait : t.ok} />
                <Text style={[ty(13, "s", t.text), { flex: 1 }]}>Μερίδιο {i + 1} · {x.method}</Text>
                <Text style={[ty(13, "s", x.status === "PENDING" ? t.wait : t.text), num]}>{x.status === "PENDING" ? "στο τερματικό" : euro(x.amountCents)}</Text>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ flex: 1 }} />
        <View style={{ borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}><Text style={ty(15, "s", t.text)}>Πληρώνει τώρα</Text><Text style={[ty(28, "b", over ? t.bad : t.text), { letterSpacing: -0.5 }, num]}>{euro(cents)}</Text></View>
          <Text accessibilityLiveRegion="polite" style={[ty(12.5, "m", over ? t.bad : t.muted), { lineHeight: 18 }, num]}>
            {over ? `! Πάνω από όσα μένουν (${euro(left)})` : last ? "Με αυτό κλείνει ο λογαριασμός: βγαίνει η απόδειξη με όλες τις πληρωμές" : `Μετά μένουν ${euro(left - cents)}`}
          </Text>
        </View>
        {inTerminal ? <Text style={[ty(12.5, "m", t.wait), { lineHeight: 18 }]}>Ένα μερίδιο περιμένει το τερματικό σε άλλο ταμείο. Περίμενε να τελειώσει.</Text> : null}
        <Methods t={t} methods={methods} method={method} setMethodId={setMethodId} />
        <PayButton t={t} label={busy ? "Περίμενε…" : last ? "Είσπραξη και απόδειξη" : `Είσπραξη μεριδίου ${k}`} cents={Math.min(cents, left)} disabled={busy || !method || !cents || over || inTerminal}
          onPress={() => (last ? onPay() : onShare(cents))} />
      </View>
    </View>
  );
}

// ---- Ταμείο ----

function Till({ t, session, onUnpair }: { t: Theme; session: Session; onUnpair: () => void }) {
  const { width } = useWindowDimensions();
  const [catalog, setCatalog] = useState<Catalog>();
  const [online, setOnline] = useState(true);
  const [cat, setCat] = useState<number>(); // undefined = «Συχνά» αν υπάρχουν, αλλιώς η πρώτη κατηγορία
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [methodId, setMethodId] = useState<string>();
  const [cash, setCash] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  // πωλήσεις χωρίς σύνδεση που δεν ανέβηκαν ακόμα στον server (offline.ts)
  const [outbox, setOutboxState] = useState<Outbox>({ lastAa: 0, sales: [] });
  const outboxRef = useRef(outbox);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const [view, setView] = useState<"sale" | "tables" | "bill" | "reservations" | "transactions" | "orders" | "drawer" | "day">("sale");
  // τηλεφωνική παραγγελία: το καλάθι πάει σε παραγγελία αντί για είσπραξη (OrdersScreen.tsx)
  const [order, setOrder] = useState<OrderDraft>();
  const [orderNote, setOrderNote] = useState<string>();
  const [sendingOrder, setSendingOrder] = useState(false);
  const [lookedUp, setLookedUp] = useState<{ customer: Customer | null; phone: string }>();
  const [shift, setShift] = useState<ShiftState>(); // βάρδια ταμία· on=false: το κατάστημα δεν χρησιμοποιεί βάρδιες
  const [billId, setBillId] = useState<string>();
  const [target, setTarget] = useState<{ id: string; title: string }>(); // η πώληση γράφεται σε αυτόν τον λογαριασμό
  // πληρώνεται λογαριασμός, όχι το καλάθι· lines = μόνο όσα διάλεξε το μοίρασμα, billDueCents = όσα χρωστούσε όλος πριν
  // share: μερίδιο του μοιράσματος κατά ποσό (χωρίς απόδειξη ακόμα)
  const [paying, setPaying] = useState<{ id: string; title: string; dueCents: number; items: number; lines?: BillPick[]; billDueCents: number; share?: boolean }>();
  const [split, setSplit] = useState<Split>(null);
  const [people, setPeople] = useState(2); // «ίσα σε» όσους μένουν να πληρώσουν
  const unpaired = useCallback(() => setStatus({ kind: "unpaired" }), []);

  const setPending = useCallback(async (p: Pending | null) => {
    pendingRef.current = p;
    setPendingState(p);
    await (p ? savePending(p) : clearPending());
  }, []);

  const setOutbox = useCallback(async (o: Outbox) => {
    outboxRef.current = o;
    setOutboxState(o);
    await saveOutbox(o);
  }, []);

  /** Ανεβάζει την ουρά με τη σειρά. Ό,τι η Viva δεν βεβαίωσε ακόμα μένει για την επόμενη φορά· ό,τι αρνήθηκε ο server μένει για τον υπεύθυνο. */
  const syncOutbox = useCallback(async () => {
    for (const sale of outboxRef.current.sales.filter((x) => !x.rejected)) {
      let r: Awaited<ReturnType<typeof syncOffline>>;
      try { r = await syncOffline(session, sale); setOnline(true); } catch { setOnline(false); return; }
      if (r === "pending") continue;
      const o = outboxRef.current;
      await setOutbox({ ...o, sales: r === "done" ? o.sales.filter((x) => x.saleId !== sale.saleId) : o.sales.map((x) => (x.saleId === sale.saleId ? { ...x, rejected: r.rejected } : x)) });
    }
  }, [session, setOutbox]);

  const loadCatalog = useCallback(() => {
    getCatalog(session).then(
      (c) => { setCatalog(c); setOnline(true); void saveCachedCatalog(c); void syncOutbox(); },
      (e) => {
        if (e instanceof ApiError && e.status === 401) return setStatus({ kind: "unpaired" });
        setOnline(false);
        // χωρίς σύνδεση: το ταμείο δουλεύει με τον τελευταίο κατάλογο, αν η συσκευή μπορεί να βγάλει απόδειξη μόνη της
        void loadCachedCatalog().then((cached) => {
          if (cached?.offline) setCatalog((c) => c ?? cached);
          else setStatus((s) => s ?? { kind: "offline" });
        });
      },
    );
  }, [session, syncOutbox]);
  useEffect(() => { void loadOutbox().then((o) => { outboxRef.current = o; setOutboxState(o); }); }, []);
  // όσο υπάρχουν πωλήσεις στην ουρά, δοκιμάζουμε κάθε λεπτό
  const unsynced = outbox.sales.filter((x) => !x.rejected).length;
  useEffect(() => {
    if (!unsynced) return;
    const id = setInterval(() => void syncOutbox(), 60_000);
    return () => clearInterval(id);
  }, [unsynced, syncOutbox]);
  useEffect(loadCatalog, [loadCatalog]);
  const loadShift = useCallback(() => {
    getShift(session).then(setShift, (e) => { if (e instanceof ApiError && e.status === 401) setStatus({ kind: "unpaired" }); });
  }, [session]);
  // κάθε επιστροφή στην πώληση ξαναρωτά τη βάρδια (π.χ. μπήκε PIN στην κονσόλα ή έκλεισε η μέρα)
  useEffect(() => { if (view === "sale") loadShift(); }, [view, loadShift]);

  // Μόνο μετρητά και κάρτα: το IRIS μέσα από το Viva Terminal δεν έχει επαληθευτεί σε αυτή τη σύνδεση (spec).
  const methods = useMemo(() => (catalog?.paymentMethods ?? []).filter((m) => m.code === "cash" || m.code === "card"), [catalog]);
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  // Χρώμα κατηγορίας: η θέση 1–8 που όρισε η κονσόλα, αλλιώς με τη σειρά (χωρίς το ουδέτερο, που κρατιέται για τα «Συχνά»).
  const colorOf = useCallback((i: number) => { const c = catalog?.categories[i]?.color; return t.categories[c && c >= 1 && c <= 8 ? c - 1 : 1 + (i % 7)]; }, [catalog, t]);
  const byId = useMemo(() => new Map(catalog?.categories.flatMap((c, i) => c.products.map((p) => [p.id, { product: p, color: colorOf(i) }] as const)) ?? []), [catalog, colorOf]);
  const frequent = useMemo(() => (catalog?.frequent ?? []).map((id) => byId.get(id)?.product).filter((p): p is Product => !!p), [catalog, byId]);
  const tab = cat ?? (frequent.length ? -1 : 0); // -1 = «Συχνά»

  const lines = cart.flatMap((l) => { const hit = byId.get(l.productId); return hit ? [{ ...l, ...hit, unitCents: unitPrice(hit.product.priceCents, hit.product.groups, l.options) }] : []; });
  const sums = totals(lines.map((l) => ({ priceCents: l.unitCents, vatRate: l.product.vatRate, quantity: l.quantity })));
  const inCart = (id: string) => lines.reduce((n, l) => n + (l.productId === id ? l.quantity : 0), 0);

  /** Βάζει γραμμή στο καλάθι· ίδιο προϊόν με ίδιες επιλογές και σημείωση = ίδια γραμμή. replace: η γραμμή που διορθώνεται. */
  const putLine = (productId: string, options: string[], note: string, quantity: number, replace?: string) => {
    const key = lineKey(productId, options, note);
    setCart((c) => {
      const rest = c.filter((l) => l.key !== replace);
      const same = rest.find((l) => l.key === key);
      return same ? rest.map((l) => (l === same ? { ...l, quantity: l.quantity + quantity } : l)) : [...rest, { key, productId, options, note: note.trim(), quantity }];
    });
    setSelected(key);
  };
  /** Ξεκινά τηλεφωνική παραγγελία· με past («Ξανά») το καλάθι γεμίζει με τις γραμμές της με τις σημερινές τιμές. */
  const startOrder = (d: OrderDraft, past?: PastLine[]) => {
    setTarget(undefined); setOrder(d); setOrderNote(undefined); setSelected(undefined); setView("sale");
    if (!past) return setCart([]);
    const r = reorderLines(past, new Map([...byId].map(([id, h]) => [id, { groups: h.product.groups }])));
    setCart(r.ok.map((l) => ({ ...l, key: lineKey(l.productId, l.options, l.note) })));
    if (r.missing.length) setOrderNote(`Δεν μπήκαν: ${r.missing.join(", ")}. Δεν υπάρχουν πια στον κατάλογο.`);
  };
  const setQty = (key: string, quantity: number) => setCart((c) => (quantity > 0 ? c.map((l) => (l.key === key ? { ...l, quantity } : l)) : c.filter((l) => l.key !== key)));
  const plainKey = (id: string) => lineKey(id, [], "");

  // Προϊόν με υποχρεωτικές επιλογές ανοίγει το φύλλο· τα άλλα μπαίνουν κατευθείαν.
  const tapProduct = (p: Product, color: string) => {
    if (p.groups.some((g) => g.kind === "REQUIRED")) setDraft({ product: p, color, options: [], note: "", quantity: 1 });
    else putLine(p.id, [], "", 1);
  };
  const editLine = (l: (typeof lines)[number]) => setDraft({ product: l.product, color: l.color, editKey: l.key, options: l.options, note: l.note, quantity: l.quantity });
  const finishDraft = () => {
    if (!draft) return;
    putLine(draft.product.id, draft.options, draft.note, draft.quantity, draft.editKey);
    setDraft(undefined);
  };

  /** Κλείνει μια πληρωμή με ό,τι απάντησε ο server. Η εκκρεμότητα σβήνεται ΜΟΝΟ σε «πληρώθηκε» ή «δεν έγινε». */
  const settle = useCallback(async (ask: () => Promise<Outcome>, attempt = 0) => {
    setBusy(true);
    try {
      const o = await ask();
      setOnline(true);
      if (o.state === "paid") { await setPending(null); setStatus({ kind: "paid", series: o.series, aa: o.aa }); }
      else if (o.state === "failed") { await setPending(null); setStatus({ kind: "failed" }); }
      else setStatus({ kind: "unknown", attempt, checkedAt: new Date(), noPaymentYet: o.noPaymentYet });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "");
      if (err.status === 401) setStatus({ kind: "unpaired" });
      else if (err.status === 403) setStatus({ kind: "blocked", message: err.message || "Το ταμείο είναι κλειστό αυτή τη στιγμή." });
      else if (err.status === 409 && err.code === "verification_failed") setStatus({ kind: "unverified" });
      // η πώληση δεν περιμένει πια πληρωμή στον server (γύρισε σε πρόχειρο ή δεν υπάρχει)
      else if (err.status === 404) { await setPending(null); setStatus({ kind: "failed" }); }
      // το τερματικό είπε «πληρώθηκε» αλλά η πώληση δεν περιμένει πια πληρωμή: δεν ξέρουμε αν χρεώθηκε, το λύνει ο υπεύθυνος
      else if (err.status === 409 && err.code === "invalid_state") { await setPending(null); setStatus({ kind: "unverified" }); }
      // δίκτυο, 502 ή οτιδήποτε άλλο: η πληρωμή μπορεί να έγινε, άρα ΔΕΝ είναι αποτυχία
      else { if (err.status === 0) setOnline(false); setStatus({ kind: "unknown", attempt, checkedAt: new Date(), noPaymentYet: false }); }
    } finally {
      setBusy(false);
    }
  }, [setPending]);

  const check = useCallback((attempt = 0) => {
    const p = pendingRef.current;
    if (!p) return;
    const off = p.offline;
    if (off) {
      if (p.callback) {
        const r = parseResult(p.callback);
        // πληρώθηκε στο Viva Terminal: η απόδειξη είναι έγκυρη, ο server τη μαθαίνει από την ουρά
        if (r.success) void (async () => { await setOutbox(enqueue(outboxRef.current, { ...off, transactionId: r.transactionId })); await setPending(null); setStatus({ kind: "paid", series: catalog?.offline?.series ?? null, aa: off.aa }); void syncOutbox(); })();
        else void (async () => { await setPending(null); setStatus({ kind: "failed" }); })(); // ο ΑΑ μένει ελεύθερος
      } else {
        // χωρίς callback (έκλεισε η εφαρμογή): ρωτάμε τον server, που ρωτά τη Viva
        void settle(async () => {
          const r = await syncOffline(session, off);
          if (r === "pending") return { state: "unknown", noPaymentYet: true };
          if (r !== "done") return { state: "failed" };
          await setOutbox({ ...outboxRef.current, lastAa: Math.max(outboxRef.current.lastAa, off.aa) });
          return { state: "paid", series: catalog?.offline?.series ?? null, aa: off.aa };
        }, attempt);
      }
      return;
    }
    if (p.callback) { const r = parseResult(p.callback); void settle(() => reportResult(session, p.saleId, { success: r.success, transactionId: r.transactionId, callback: p.callback! }), attempt); }
    else void settle(() => checkResult(session, p.saleId), attempt);
  }, [session, settle, catalog, setOutbox, setPending, syncOutbox]);

  // Επιστροφή από το Viva Terminal: το callback γράφεται πρώτα στη συσκευή, μετά πηγαίνει στον server.
  const onUrl = useCallback(async (url: string) => {
    const p = pendingRef.current;
    if (!isVivaResult(url) || !p) return false;
    // callback άλλης, παλιότερης πώλησης δεν αγγίζει αυτήν που πληρώνεται τώρα
    const about = parseResult(url).clientTransactionId;
    if (about && about !== p.saleId) return false;
    await setPending({ ...p, callback: url });
    check();
    return true;
  }, [check, setPending]);

  // Στο άνοιγμα: πρώτα η αποθηκευμένη εκκρεμότητα, πριν φανεί το ταμείο. Καλύπτει και εκκίνηση από το callback της Viva.
  useEffect(() => {
    void (async () => {
      const p = await loadPending();
      if (!p) return;
      pendingRef.current = p;
      setPendingState(p);
      const url = await Linking.getInitialURL();
      // Αν το αρχικό callback ήταν άλλης πώλησης και αγνοήθηκε, η εκκρεμότητα δεν μένει κρυμμένη πίσω από το ταμείο.
      if (url && (await onUrl(url))) return;
      if (p.callback || p.external) check();
      else setStatus({ kind: "resume" });
    })();
    const sub = Linking.addEventListener("url", ({ url }) => void onUrl(url));
    return () => sub.remove();
    // μία φορά στο άνοιγμα· τα onUrl/check διαβάζουν την εκκρεμότητα από ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // POS σε άλλη συσκευή: δεν έρχεται callback, άρα ρωτάμε τον server ανά 3″ όσο περιμένουμε.
  useEffect(() => {
    if (status?.kind !== "waiting" || !pending?.external) return;
    const id = setInterval(() => {
      void checkResult(session, pending.saleId).then((o) => { if (o.state !== "unknown") void settle(async () => o); }, () => undefined);
    }, 3000);
    return () => clearInterval(id);
  }, [status, pending, session, settle]);

  // «Δεν ξέρουμε ακόμα»: ρωτάμε ξανά μόνοι μας, με αυξανόμενη αναμονή.
  useEffect(() => {
    if (status?.kind !== "unknown") return;
    const id = setTimeout(() => check(status.attempt + 1), retryDelayMs(status.attempt));
    return () => clearTimeout(id);
  }, [status, check]);

  // Το «πίσω» του Android δεν κλείνει πληρωμή σε εξέλιξη ή άγνωστη· στο φύλλο επιλογών το κλείνει.
  const locked = status?.kind === "waiting" || status?.kind === "unknown" || status?.kind === "resume" || status?.kind === "cancel";
  useEffect(() => {
    if (!locked && !draft) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { if (!locked) setDraft(undefined); return true; });
    return () => sub.remove();
  }, [locked, draft]);

  const openViva = (p: Pending) => Linking.openURL(saleUrl(p)).catch(() => setStatus({ kind: "unknown", attempt: 0, checkedAt: new Date(), noPaymentYet: false }));

  const startPayment = async (withMethod = method, bill = paying) => {
    if (!withMethod || (!bill && !lines.length)) return;
    setCash(false);
    setBusy(true);
    try {
      const sale = bill?.share ? await shareBill(session, bill.id, withMethod.id, bill.dueCents)
        : bill ? await settleBill(session, bill.id, withMethod.id, bill.lines) : await createSale(session, withMethod.id, cartOut());
      setOnline(true);
      if ("paid" in sale) { setStatus({ kind: "paid", series: null, aa: null }); return; } // μερίδιο σε μετρητά: καταγράφηκε, χωρίς τερματικό
      const p: Pending = { ...sale, methodName: withMethod.name, startedAt: new Date().toISOString(), items: bill ? bill.items : lines.reduce((n, l) => n + l.quantity, 0) };
      await setPending(p); // πριν ανοίξει το Viva Terminal: αν κλείσει η εφαρμογή, η πληρωμή δεν χάνεται
      setStatus({ kind: "waiting" });
      if (!p.external) await openViva(p);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "");
      const left = err.body.pending as (Pending & { issuedAt?: string }) | null | undefined;
      if (err.status === 0) { setOnline(false); if (!bill && (await startOffline(withMethod))) return; setStatus({ kind: "offline" }); }
      else if (err.status === 401) setStatus({ kind: "unpaired" });
      else if (err.status === 403) setStatus({ kind: "blocked", message: err.message || "Το ταμείο είναι κλειστό αυτή τη στιγμή." });
      // υπάρχει ήδη πληρωμή σε εξέλιξη σε αυτό το ταμείο: τη συνεχίζουμε, δεν ξεκινάμε δεύτερη
      else if (err.status === 409 && left) { await setPending({ saleId: left.saleId, amountCents: left.amountCents, fiscalisationData: left.fiscalisationData, external: left.external, methodName: left.methodName ?? "", startedAt: left.issuedAt ?? new Date().toISOString(), items: 0 }); setStatus({ kind: "resume" }); }
      // ο κατάλογος άλλαξε στο μεταξύ (επιλογή που δεν υπάρχει πια): ξαναφορτώνουμε για να το δει ο ταμίας
      // ο λογαριασμός άλλαξε από άλλη συσκευή (πληρώθηκαν ή ακυρώθηκαν είδη, έκλεισε): ο server το λέει με λόγια
      else if (bill && (err.status === 409 || err.status === 404)) setStatus({ kind: "blocked", message: err.message || "Ο λογαριασμός άλλαξε στο μεταξύ. Δες τον ξανά." });
      else if (err.status === 400 && err.code === "invalid_options") { loadCatalog(); setStatus({ kind: "blocked", message: `${err.message || "Μια επιλογή άλλαξε στον κατάλογο."} Διόρθωσε τη γραμμή από τις «Επιλογές».` }); }
      else setStatus({ kind: "failed" }); // η πώληση δεν ξεκίνησε: ο πελάτης δεν χρεώθηκε
    } finally {
      setBusy(false);
    }
  };

  /** Πώληση χωρίς σύνδεση: η απόδειξη χτίζεται στη συσκευή (offline.ts). Όχι για λογαριασμούς τραπεζιών: θέλουν τον server. */
  const startOffline = async (m: PaymentMethod) => {
    const ctx = catalog?.offline;
    if (!ctx || m.payItemCase == null || !lines.length) return false;
    const out = lines.map((l) => ({
      productId: l.productId, name: l.product.name, quantity: l.quantity, unitPriceCents: l.unitCents, vatRate: l.product.vatRate,
      options: l.options.map((id) => { const o = l.product.groups.flatMap((g) => g.options).find((x) => x.id === id); return { name: o?.name ?? "", priceCents: o?.priceCents ?? 0 }; }),
      ...(l.note ? { note: l.note } : {}),
    }));
    const { sale, fiscalisationData } = offlineSale(ctx, outboxRef.current, { id: m.id, name: m.name, payItemCase: m.payItemCase }, out);
    const p: Pending = { saleId: sale.saleId, amountCents: sale.amountCents, fiscalisationData, offline: sale, methodName: m.name, startedAt: new Date().toISOString(), items: lines.reduce((n, l) => n + l.quantity, 0) };
    await setPending(p); // πριν ανοίξει το Viva Terminal, όπως και με σύνδεση
    setStatus({ kind: "waiting" });
    await openViva(p);
    return true;
  };

  // Έξοδος από πληρωμή που κόλλησε: η συσκευή δηλώνει «δεν πληρώθηκε». Ο server ρωτά πρώτα τη Viva· αν βρει
  // πληρωμή κλείνει την απόδειξη κανονικά (και η οθόνη λέει «πληρώθηκε»), αλλιώς η πώληση γυρίζει σε πρόχειρο.
  const cancelPayment = () => {
    if (pending) void settle(() => reportResult(session, pending.saleId, { success: false, callback: "cancelled-by-cashier" }));
  };
  const askCancel: Action = { label: "Ακύρωση πληρωμής", onPress: () => status && setStatus({ kind: "cancel", back: status }) };

  const charge = () => (method?.code === "cash" ? setCash(true) : void startPayment());
  const cartOut = () => lines.map((l) => ({ productId: l.productId, quantity: l.quantity, options: l.options, ...(l.note ? { note: l.note } : {}) }));
  const payBill = (b: Bill, title: string, pick?: Pick) => {
    const p = pick
      ? { id: b.id, title, dueCents: pick.cents, items: pick.items, lines: pick.lines, billDueCents: b.dueCents }
      : { id: b.id, title, dueCents: b.dueCents - b.heldCents, items: b.lines.reduce((n, l) => n + l.remaining, 0), billDueCents: b.dueCents - b.heldCents };
    setPaying(p);
    if (method?.code === "cash") setCash(true); else void startPayment(method, p);
  };
  const payShare = (b: Bill, title: string, cents: number) => {
    const p = { id: b.id, title, dueCents: cents, items: 0, billDueCents: b.dueCents - b.heldCents, share: true };
    setPaying(p);
    if (method?.code === "cash") setCash(true); else void startPayment(method, p);
  };
  // Η πώληση πηγαίνει στον λογαριασμό του τραπεζιού ως νέα αποστολή· πληρώνεται αργότερα από τον λογαριασμό.
  const sendToBill = async () => {
    if (!target || !lines.length) return;
    setBusy(true);
    try {
      await sendRound(session, target.id, cartOut());
      setOnline(true);
      setCart([]); setSelected(undefined); setTarget(undefined);
      setBillId(target.id); setView("bill");
    } catch (e) {
      if (unpairedBy(e)) setStatus({ kind: "unpaired" });
      else setStatus({ kind: "blocked", message: `Η παραγγελία δεν στάλθηκε στο ${target.title}. ${failText(e)} Η παραγγελία έμεινε στην οθόνη.` });
    } finally {
      setBusy(false);
    }
  };
  const toTables = () => { setPaying(undefined); setTarget(undefined); setSplit(null); setView("tables"); };
  const backToSale = () => setStatus(undefined);

  if (status) {
    const amount = pending ? euro(pending.amountCents) : euro(paying ? paying.dueCents : sums.totalCents);
    const how = pending?.methodName || method?.name || "";
    const summary = pending ? `${amount} · ${how}${pending.items ? ` · ${kinds(pending.items)}` : ""} · ${time(pending.startedAt)}` : undefined;
    // StatusCard γράφεται κατευθείαν ως JSX (όχι helper): ο React Compiler δεν δέχεται κλήση συνάρτησης στο render με handlers που διαβάζουν ref
    // Χαμένη απάντηση του server: το Viva Terminal μπορεί να μην άνοιξε ποτέ για αυτή την πώληση, και τότε η Viva δεν θα
    // απαντήσει ποτέ. Το ξανάνοιγμα όμως μπορεί να χρεώσει δεύτερη φορά πελάτη που ήδη πλήρωσε, άρα προσφέρεται ΜΟΝΟ όταν
    // ο server ρώτησε τη Viva και εκείνη είπε ότι δεν έχει πληρωμή, και δεν έχει γυρίσει callback. Ποτέ μετά από σφάλμα δικτύου.
    const reopen: Action[] = status.kind === "unknown" && status.noPaymentYet && pending && !pending.callback
      ? [{ label: "Ο πελάτης δεν πλήρωσε: άνοιξε το Viva Terminal", onPress: () => { setStatus({ kind: "waiting" }); void openViva(pending); } }] : [];
    switch (status.kind) {
      case "waiting": if (pending?.external) return <StatusCard t={t} busy={busy} summary={summary} tone="neutral" label="Σε εξέλιξη" title="Πλήρωσε στο POS" text={`${how} · ${amount}. Η χρέωση στάλθηκε στο POS της Viva. Η οθόνη αλλάζει μόνη της μόλις τελειώσει.`} actions={[askCancel, { label: "Έλεγχος πληρωμής", onPress: () => check(), primary: true }]} />;
        return <StatusCard t={t} busy={busy} summary={summary} tone="neutral" label="Σε εξέλιξη" title="Περιμένουμε το Viva Terminal" text={`${how} · ${amount}. Η οθόνη αλλάζει μόνη της μόλις τελειώσει.`} actions={[askCancel, { label: "Viva Terminal", onPress: () => pending && void openViva(pending) }, { label: "Έλεγχος πληρωμής", onPress: () => check(), primary: true }]} />;
      case "paid": return <StatusCard t={t} busy={busy} summary={summary} tone="ok" label="Ολοκληρώθηκε" title={paying?.share ? `Εισπράχθηκε μερίδιο ${amount}` : `Πληρώθηκε ${amount}`} text={`${how}${status.aa != null ? ` · απόδειξη ${status.series ?? ""} ${status.aa}` : ""}.${paying?.share ? " Η απόδειξη βγαίνει με το τελευταίο μερίδιο." : ""}${paying && paying.billDueCents > paying.dueCents ? ` Στον λογαριασμό μένουν ${euro(paying.billDueCents - paying.dueCents)}.` : ""}`} actions={[paying?.share
        ? { label: "Επόμενο μερίδιο", primary: true, onPress: () => { setPeople(Math.max(1, people - 1)); setPaying(undefined); backToSale(); } }
        : paying && paying.billDueCents > paying.dueCents
        ? { label: "Επόμενη απόδειξη", primary: true, onPress: () => { setPaying(undefined); backToSale(); } }
        : paying
        ? { label: "Στα τραπέζια", primary: true, onPress: () => { toTables(); backToSale(); } }
        : { label: "Νέα πώληση", primary: true, onPress: () => { setCart([]); setSelected(undefined); backToSale(); } }]} />;
      case "unknown": return <StatusCard t={t} busy={busy} summary={summary} tone="wait" label="Περιμένει" title="Δεν ξέρουμε ακόμα αν πληρώθηκε" text="Η Viva δεν απάντησε. Ρωτάμε ξανά μόνοι μας. Μην χρεώσεις ξανά τον πελάτη." actions={[askCancel, ...reopen, { label: "Έλεγξε ξανά τώρα", primary: true, onPress: () => check(status.attempt) }]} note={`Τελευταίος έλεγχος ${time(status.checkedAt)}`} />;
      case "failed": return <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Θέλει ενέργεια" title="Η πληρωμή δεν έγινε" text={`Ο πελάτης δεν χρεώθηκε. ${paying ? `Ο λογαριασμός «${paying.title}» μένει ανοιχτός.` : lines.length ? "Η πώληση είναι όπως την άφησες." : "Η πώληση ακυρώθηκε· ξεκίνα νέα."}`} actions={[
        ...(lines.length || paying ? methods.map((m) => ({ label: m.code === "cash" ? "Με μετρητά" : "Ξανά με κάρτα", onPress: () => { setMethodId(m.id); setStatus(undefined); if (m.code === "cash") setCash(true); else void startPayment(m); } })) : []),
        { label: paying ? "Πίσω στον λογαριασμό" : "Πίσω στην πώληση", onPress: () => { setPaying(undefined); backToSale(); }, primary: true },
      ]} />;
      case "unverified": return <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Θέλει ενέργεια" title="Η πληρωμή δεν έγινε" text="Η Viva δεν επιβεβαίωσε την πληρωμή. Μην δώσεις το προϊόν ως πληρωμένο· φώναξε τον υπεύθυνο." actions={[{ label: "Πίσω στην πώληση", onPress: backToSale, primary: true }]} />;
      case "resume": return <StatusCard t={t} busy={busy} summary={summary} tone="wait" label="Περιμένει" title="Έμεινε μια πληρωμή στη μέση" text={`Η εφαρμογή έκλεισε πριν μάθουμε αν πληρώθηκε: ${amount}${how ? `, ${how}` : ""}${pending ? `, ${time(pending.startedAt)}` : ""}.`} actions={[askCancel, { label: "Έλεγξε αν πληρώθηκε", primary: true, onPress: () => check() }]} />;
      case "cancel": return <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Επιβεβαίωση" title="Ακύρωση πληρωμής;" text="Κάν' το μόνο αν ο πελάτης δεν πλήρωσε. Πρώτα ρωτάμε τη Viva: αν βρει πληρωμή, η απόδειξη κλείνει κανονικά. Αλλιώς η πώληση ακυρώνεται και ο πελάτης δεν χρεώνεται." actions={[
        { label: "Πίσω", onPress: () => setStatus(status.back) },
        { label: "Ο πελάτης δεν πλήρωσε", primary: true, onPress: cancelPayment },
      ]} />;
      case "offline": return <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Θέλει ενέργεια" title="Δεν υπάρχει σύνδεση" text="Το ταμείο δεν μπορεί να βγάλει απόδειξη χωρίς internet. Η πώληση που έγραψες μένει στη συσκευή." actions={[
        // χωρίς κατάλογο (π.χ. άλλαξε η διεύθυνση του server) η μόνη έξοδος είναι νέα σύνδεση
        ...(catalog ? [{ label: "Πίσω στην πώληση", onPress: backToSale }] : [{ label: "Αποσύνδεση ταμείου", onPress: () => setStatus({ kind: "unpair" }) }]),
        { label: "Δοκίμασε ξανά", primary: true, onPress: () => { if (catalog && (lines.length || paying)) void startPayment(); else { setStatus(undefined); loadCatalog(); } } },
      ]} />;
      // Με πληρωμή στη μέση δεν αποσυνδέεται: η εκκρεμότητα θα χανόταν μαζί με το κλειδί.
      case "unpair": return pending
        ? <StatusCard t={t} busy={busy} summary={summary} tone="wait" label="Περιμένει" title="Πρώτα η πληρωμή που έμεινε" text="Υπάρχει πληρωμή που δεν ξέρουμε αν έγινε. Έλεγξέ την πρώτα και μετά αποσύνδεσε το ταμείο." actions={[{ label: "Πίσω", primary: true, onPress: backToSale }]} />
        : <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Επιβεβαίωση" title="Αποσύνδεση ταμείου;" text={`Η συσκευή ξεχνά το «${catalog?.device.name ?? "ταμείο"}». Για να ξαναπουλήσει, θέλει νέο QR σύνδεσης από την κονσόλα (Συσκευές → Ετοιμότητα).`} actions={[
          { label: "Πίσω", onPress: catalog ? backToSale : () => setStatus({ kind: "offline" }) },
          { label: "Αποσύνδεση", primary: true, onPress: onUnpair },
        ]} />;
      case "unpaired": return <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Θέλει ενέργεια" title="Το ταμείο αποσυνδέθηκε" text="Το κλειδί της συσκευής δεν ισχύει. Ζήτα νέο κωδικό σύζευξης από τον διαχειριστή." actions={[{ label: "Νέα σύζευξη", primary: true, onPress: onUnpair }]} />;
      case "blocked": return <StatusCard t={t} busy={busy} summary={summary} tone="bad" label="Θέλει ενέργεια" title={paying ? "Δεν ξεκίνησε η πληρωμή" : "Δεν έγινε η πώληση"} text={status.message} actions={[{ label: paying ? "Πίσω στον λογαριασμό" : "Πίσω στην πώληση", onPress: () => { setPaying(undefined); backToSale(); }, primary: true }]} />;
    }
  }
  // Ο κατάλογος απέτυχε όσο φαινόταν άλλη οθόνη: όχι ατελείωτο «φορτώνει», αλλά σφάλμα με «Δοκίμασε ξανά».
  if (!catalog && !online) return <StatusCard t={t} tone="bad" label="Θέλει ενέργεια" title="Δεν φόρτωσε ο κατάλογος" text="Δεν υπάρχει σύνδεση με τον server. Έλεγξε το internet της συσκευής." actions={[{ label: "Δοκίμασε ξανά", primary: true, onPress: () => { setOnline(true); loadCatalog(); } }]} busy={false} />;
  if (!catalog) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>;
  if (cash) return <CashSheet t={t} totalCents={paying ? paying.dueCents : sums.totalCents} onContinue={() => void startPayment()} onBack={() => { setCash(false); setPaying(undefined); }} back={paying ? "Πίσω στον λογαριασμό" : undefined} go={paying?.share ? "Καταγραφή είσπραξης" : undefined} />;

  const wide = width >= 1000;
  const panelW = width >= 700 ? 348 : 300;
  const gridW = width - panelW - (wide ? 200 : 60) - 32; // 16 περιθώριο δεξιά-αριστερά
  const cols = Math.max(2, Math.min(5, Math.floor((gridW + 8) / 168)));
  const keyW = (gridW - 8 * (cols - 1)) / cols; // σταθερό πλάτος: η τελευταία, μισογεμάτη σειρά δεν απλώνει τα πλήκτρα της

  const q = query.trim().toLowerCase();
  const shown = q
    ? catalog.categories.flatMap((c, i) => c.products.filter((p) => p.name.toLowerCase().includes(q) || p.code?.toLowerCase() === q).map((p) => ({ p, color: colorOf(i) })))
    : tab === -1 ? frequent.map((p) => ({ p, color: byId.get(p.id)!.color }))
    : (catalog.categories[tab]?.products ?? []).map((p) => ({ p, color: colorOf(tab) }));
  const heading = q ? `Αναζήτηση «${query.trim()}»` : tab === -1 ? "Συχνά" : catalog.categories[tab]?.name ?? "";
  const tiles = [...(frequent.length ? [{ i: -1, name: "Συχνά", count: frequent.length, color: t.categories[0], Icon: Star }] : []), ...catalog.categories.map((c, i) => ({ i, name: c.name, count: c.products.length, color: colorOf(i), Icon: catIcon(c.name) }))];
  const tablesOn = catalog.hasTables !== false; // παλιός server χωρίς το πεδίο: τα δείχνουμε όπως πριν
  const items = lines.reduce((n, l) => n + l.quantity, 0);

  const navItem = (label: string, Icon: LucideIcon, on: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} style={({ pressed }) => ({ height: 44, minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: wide ? "flex-start" : "center", gap: 10, paddingHorizontal: wide ? 12 : 0, borderRadius: 12, backgroundColor: on ? t.raised : pressed ? t.panel : "transparent" })}>
      <Icon {...ICON} color={on ? t.text : t.muted} />{wide ? <Text style={ty(14, "s", on ? t.text : t.muted)}>{label}</Text> : null}
    </Pressable>
  );
  const navBar = !wide ? (
    <View style={{ width: 60, paddingVertical: 20, paddingHorizontal: 8, gap: 4, borderRightWidth: 1, borderRightColor: t.divider }}>
      {navItem("Πώληση", IceCreamCone, view === "sale", () => setView("sale"))}
      {tablesOn ? navItem("Τραπέζια", LayoutGrid, view === "tables" || view === "bill", toTables) : null}
      {tablesOn ? navItem("Κρατήσεις", CalendarClock, view === "reservations", () => setView("reservations")) : null}
      {navItem("Παραγγελίες", Bike, view === "orders", () => setView("orders"))}
      {navItem("Συναλλαγές", ReceiptText, view === "transactions", () => setView("transactions"))}
      {shift?.on ? navItem("Ταμείο", Wallet, view === "drawer" || view === "day", () => setView("drawer")) : null}
      <View style={{ flex: 1 }} />
      {shift?.on && shift.shift ? <WhoIsOn t={t} compact name={shift.shift.employee.name} since={shift.shift.startedAt} onSwitch={() => setView("drawer")} /> : null}
    </View>
  ) : (
    <View style={{ width: 200, paddingVertical: 20, paddingHorizontal: 12, gap: 2, borderRightWidth: 1, borderRightColor: t.divider }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 20 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.categories[7] }} />
        <Text style={ty(15.5, "b", t.text)}>Gelato System</Text>
      </View>
      {navItem("Πώληση", IceCreamCone, view === "sale", () => setView("sale"))}
      {tablesOn ? navItem("Τραπέζια", LayoutGrid, view === "tables" || view === "bill", toTables) : null}
      {tablesOn ? navItem("Κρατήσεις", CalendarClock, view === "reservations", () => setView("reservations")) : null}
      {navItem("Παραγγελίες", Bike, view === "orders", () => setView("orders"))}
      {navItem("Συναλλαγές", ReceiptText, view === "transactions", () => setView("transactions"))}
      {shift?.on ? navItem("Ταμείο", Wallet, view === "drawer" || view === "day", () => setView("drawer")) : null}
      <View style={{ flex: 1 }} />
      {shift?.on && shift.shift ? <View style={{ borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 14, paddingHorizontal: 4, paddingBottom: 14 }}><WhoIsOn t={t} name={shift.shift.employee.name} since={shift.shift.startedAt} onSwitch={() => setView("drawer")} /></View> : null}
      <View style={{ borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 16, paddingHorizontal: 8, gap: 4 }}>
        <Text numberOfLines={2} style={ty(13, "s", t.text)}>{catalog.store}</Text>
        <Text numberOfLines={1} style={[ty(12, "m", t.muted), num]}>{catalog.device.name} · σειρά {catalog.device.series}</Text>
      </View>
    </View>
  );
  const nav = <>{navBar}<CallWatcher t={t} session={session} onOrder={startOrder} onReservation={() => setView("reservations")} /></>;
  const mainW = width - (wide ? 200 : 60);
  if (shift?.on && !shift.shift) return view === "day"
    ? <DayCloseView t={t} session={session} width={width} onBack={() => setView("sale")} onClosed={loadShift} onUnpaired={unpaired} />
    : <SignInView t={t} session={session} state={shift} width={width} place={`${catalog.store} · ${catalog.device.name}`} onStarted={loadShift} onDay={() => setView("day")} onUnpaired={unpaired} />;
  if (view === "drawer") return <View style={{ flex: 1, flexDirection: "row" }}>{nav}<CloseShiftView t={t} session={session} width={mainW} now={now} onClosed={() => { setView("sale"); loadShift(); }} onDay={() => setView("day")} onUnpaired={unpaired} /></View>;
  if (view === "day") return <View style={{ flex: 1, flexDirection: "row" }}>{nav}<DayCloseView t={t} session={session} width={mainW} onBack={() => setView("drawer")} onClosed={loadShift} onUnpaired={unpaired} /></View>;
  if (view === "tables") return <View style={{ flex: 1, flexDirection: "row" }}>{nav}<Tables t={t} session={session} now={now} width={mainW - 32} onOpen={(id) => { setBillId(id); setView("bill"); }} onReservations={() => setView("reservations")} onUnpaired={unpaired} /></View>;
  if (view === "orders") return (
    <View style={{ flex: 1, flexDirection: "row" }}>{nav}
      <OrdersView t={t} session={session} now={now} width={mainW} onOpenBill={(id) => { setBillId(id); setView("bill"); }} onNewOrder={(customer, phone) => setLookedUp({ customer, phone })} onUnpaired={unpaired} />
      {lookedUp ? <CustomerSheet t={t} session={session} phone={lookedUp.phone} customer={lookedUp.customer} onClose={() => setLookedUp(undefined)} onCreated={(customer) => setLookedUp({ ...lookedUp, customer })}
        onOrder={(d, past) => { setLookedUp(undefined); startOrder(d, past); }} /> : null}
    </View>
  );
  if (view === "transactions") return <View style={{ flex: 1, flexDirection: "row" }}>{nav}<TransactionsView t={t} session={session} now={now} width={mainW} onUnpaired={unpaired} /></View>;
  if (view === "reservations") return <View style={{ flex: 1, flexDirection: "row" }}>{nav}<ReservationsView t={t} session={session} now={now} width={mainW - 32} onOpenBill={(id) => { setBillId(id); setView("bill"); }} onUnpaired={unpaired} /></View>;
  if (view === "bill" && billId) return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {nav}
      <BillView t={t} session={session} id={billId} now={now} methods={methods} method={method} setMethodId={setMethodId} busy={busy} split={split} setSplit={setSplit} people={people} setPeople={setPeople} onBack={toTables} onUnpaired={unpaired}
        onAdd={(title) => { setTarget({ id: billId, title }); setView("sale"); }} onPay={payBill} onShare={payShare} />
    </View>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {nav}

      <View style={{ flex: 1, paddingTop: 20, gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 }}>
          <View style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: t.panel, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 }}>
            <Search {...ICON} color={t.faint} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Αναζήτηση προϊόντος ή κωδικού" placeholderTextColor={t.faint} autoCorrect={false} accessibilityLabel="Αναζήτηση προϊόντος" style={{ ...ty(14.5, "m", t.text), flex: 1, height: 48 }} />
            {query ? <Pressable onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel="Καθαρισμός αναζήτησης" hitSlop={10}><X {...ICON} color={t.muted} /></Pressable> : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityLiveRegion="polite">
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? t.ok : t.bad }} />
            <Text style={ty(13, "m", online ? t.muted : t.bad)}>{online ? "Συνδεδεμένο" : catalog?.offline ? "! Χωρίς σύνδεση · αποδείξεις από τη συσκευή" : "! Χωρίς σύνδεση"}</Text>
            {unsynced ? <Text style={ty(13, "m", t.muted)}>· {unsynced} για ανέβασμα</Text> : null}
            {outbox.sales.length > unsynced ? <Text style={ty(13, "m", t.bad)}>· {outbox.sales.length - unsynced} θέλουν τον υπεύθυνο</Text> : null}
          </View>
          <Text style={[ty(13, "s", t.muted), num]}>{time(now)}</Text>
          <Pressable onPress={() => setStatus({ kind: "unpair" })} accessibilityRole="button" accessibilityLabel="Αποσύνδεση ταμείου" style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.panel : "transparent" })}>
            <LogOut {...ICON} color={t.muted} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, minWidth: "100%" }}>
          {tiles.map(({ i, name, count, color, Icon }) => {
            const on = !q && i === tab;
            return (
              <Pressable key={i} onPress={() => { setCat(i); setQuery(""); }} accessibilityRole="tab" accessibilityState={{ selected: on }} style={({ pressed }) => ({ flex: 1, minWidth: 128, height: 88, borderRadius: 14, padding: 12, justifyContent: "space-between", backgroundColor: color, opacity: pressed ? 0.85 : 1, borderWidth: 2, borderColor: on ? t.text : "transparent" })}>
                <Icon size={20} strokeWidth={1.75} color={t.ink} />
                <View>
                  <Text numberOfLines={1} style={ty(14.5, "s", t.ink)}>{name}</Text>
                  <Text style={[ty(12, "m", t.ink), { opacity: 0.65 }, num]}>{kinds(count)}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 16 }}>
          <Text style={ty(16, "s", t.text)}>{heading}</Text>
          <Text style={[ty(13, "m", t.muted), num]}>{kinds(shown.length)}</Text>
        </View>

        <FlatList
          key={cols} data={shown} keyExtractor={(x) => x.p.id} numColumns={cols}
          columnWrapperStyle={{ gap: 8 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 16 }}
          ListEmptyComponent={<Text style={[ty(13.5, "m", t.muted), { paddingVertical: 8 }]}>{q ? "Κανένα προϊόν δεν ταιριάζει." : "Αυτή η κατηγορία δεν έχει προϊόντα. Πρόσθεσέ τα από την κονσόλα, στα Προϊόντα."}</Text>}
          renderItem={({ item: { p, color } }) => {
            const n = inCart(p.id);
            const plain = !p.groups.some((g) => g.kind === "REQUIRED");
            const fg = n ? t.ink : t.text;
            return (
              <Pressable onPress={() => tapProduct(p, color)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${euro(p.priceCents)}${n ? `, ${n} στο καλάθι` : ""}${plain ? "" : ", με επιλογές"}`} style={({ pressed }) => ({ width: keyW, height: 116, borderRadius: 14, padding: 12, backgroundColor: n ? color : pressed ? t.raised : t.card, borderLeftWidth: 4, borderLeftColor: color })}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 14 }}>
                  {p.code ? <Text style={[ty(11.5, "s", fg), { opacity: 0.6, letterSpacing: 0.5 }]}>{p.code}</Text> : null}
                  {!plain ? <SlidersHorizontal size={13} strokeWidth={2} color={fg} style={{ opacity: 0.55 }} /> : null}
                </View>
                <Text numberOfLines={2} style={[ty(15, "s", fg), { marginTop: 4, lineHeight: 19 }]}>{p.name}</Text>
                <View style={{ marginTop: "auto", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[ty(14, "s", fg), { opacity: n ? 0.75 : 0.8 }, num]}>{euro(p.priceCents)}</Text>
                  {n && plain ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                      <Pressable onPress={() => setQty(plainKey(p.id), (cart.find((l) => l.key === plainKey(p.id))?.quantity ?? 0) - 1)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Ένα λιγότερο ${p.name}`} style={{ width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: "rgba(18,20,23,0.3)", alignItems: "center", justifyContent: "center" }}><Text style={ty(16, "s", t.ink)}>−</Text></Pressable>
                      <Text style={[ty(14, "b", t.ink), { minWidth: 22, textAlign: "center" }, num]}>{n}</Text>
                    </View>
                  ) : n ? <View style={{ height: 24, minWidth: 34, borderRadius: 12, paddingHorizontal: 8, backgroundColor: t.ink, alignItems: "center", justifyContent: "center" }}><Text style={[ty(12, "b", color), num]}>× {n}</Text></View> : null}
                </View>
              </Pressable>
            );
          }}
        />
      </View>

      <View style={{ width: panelW, backgroundColor: t.panel, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16, gap: 12, borderLeftWidth: 1, borderLeftColor: t.divider }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: t.divider }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text accessibilityRole="header" style={ty(16, "s", t.text)}>{target ? `Για ${target.title.replace("Τραπέζι", "το τραπέζι")}` : order ? `${order.delivery ? "Διανομή" : "Παραλαβή"} · ${order.name}` : "Πώληση"}</Text>
            <Text style={[ty(13, "m", t.muted), num]}>{kinds(items)}</Text>
          </View>
          {lines.length ? <Pressable onPress={() => { setCart([]); setSelected(undefined); }} accessibilityRole="button" accessibilityLabel="Άδειασμα πώλησης" style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}><Trash2 {...ICON} color={t.muted} /></Pressable> : <View style={{ height: 44 }} />}
        </View>
        <ScrollView style={{ flex: 1 }}>
          {lines.length === 0 ? <Text style={[ty(13.5, "m", t.muted), { paddingVertical: 8, lineHeight: 20 }]}>Πάτα ένα προϊόν για να ξεκινήσεις την πώληση.</Text> : null}
          {lines.map((l, i) => {
            const on = selected === l.key;
            const opts = optionsText(l.product.groups, l.options);
            return (
              <Pressable key={l.key} onPress={() => setSelected(on ? undefined : l.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ borderRadius: on ? 12 : 0, borderBottomWidth: on || i === lines.length - 1 ? 0 : 1, borderBottomColor: t.divider, paddingVertical: 10, paddingHorizontal: 12, gap: 4, backgroundColor: on ? t.raised : t.card, borderLeftWidth: 4, borderLeftColor: l.color }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: on ? t.card : t.raised, alignItems: "center", justifyContent: "center" }}><Text style={[ty(12, "b", t.text), num]}>{l.quantity}</Text></View>
                  <Text numberOfLines={2} style={[ty(14, "s", t.text), { flex: 1 }]}>{l.product.name}</Text>
                  <Text style={[ty(14, "s", t.text), num]}>{euro(l.unitCents * l.quantity)}</Text>
                </View>
                {opts ? <Text style={[ty(12.5, "m", t.muted), { marginLeft: 32, lineHeight: 17 }]}>{opts}</Text> : null}
                {l.note ? <Text style={[ty(12.5, "m", t.muted), { marginLeft: 32 }]}>Σημείωση: {l.note}</Text> : null}
                {on ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, marginLeft: 32 }}>
                    <Stepper t={t} value={l.quantity} label={l.product.name} onChange={(n) => setQty(l.key, n)} />
                    <Pressable onPress={() => editLine(l)} accessibilityRole="button" style={{ height: 46, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: t.line }}>
                      {l.product.groups.length ? <SlidersHorizontal size={16} strokeWidth={1.75} color={t.muted} /> : <StickyNote size={16} strokeWidth={1.75} color={t.muted} />}
                      <Text style={ty(13, "s", t.text)}>{l.product.groups.length ? "Επιλογές" : "Σημείωση"}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={ty(13, "m", t.muted)}>Καθαρή αξία</Text><Text style={[ty(13, "m", t.muted), num]}>{euro(sums.netCents)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={ty(13, "m", t.muted)}>ΦΠΑ</Text><Text style={[ty(13, "m", t.muted), num]}>{euro(sums.vatCents)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 8, marginTop: 2 }}><Text style={ty(15, "s", t.text)}>Σύνολο</Text><Text style={[ty(28, "b", t.text), { letterSpacing: -0.5 }, num]}>{euro(sums.totalCents)}</Text></View>
        </View>
        {orderNote && order ? <Text style={ty(12.5, "m", t.wait)}>{orderNote}</Text> : null}
        {order && !target ? (
          <>
            <Pressable onPress={() => setSendingOrder(true)} disabled={!lines.length} accessibilityRole="button" accessibilityState={{ disabled: !lines.length }} style={({ pressed }) => ({ height: 56, borderRadius: 28, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: !lines.length ? 0.35 : pressed ? 0.85 : 1 })}>
              <Text style={ty(16, "s", t.onAction)}>Στοιχεία και αποστολή</Text>
              <Text style={[ty(16, "b", t.onAction), num]}>{euro(sums.totalCents)}</Text>
            </Pressable>
            <Button t={t} label="Ακύρωση παραγγελίας" onPress={() => { setOrder(undefined); setOrderNote(undefined); setCart([]); setSelected(undefined); }} />
          </>
        ) : target ? (
          <>
            <Pressable onPress={() => void sendToBill()} disabled={busy || !lines.length} accessibilityRole="button" accessibilityState={{ disabled: busy || !lines.length }} style={({ pressed }) => ({ height: 56, borderRadius: 28, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: busy || !lines.length ? 0.35 : pressed ? 0.85 : 1 })}>
              <Text style={ty(16, "s", t.onAction)}>{busy ? "Περίμενε…" : "Αποστολή στο τραπέζι"}</Text>
              <Text style={[ty(16, "b", t.onAction), num]}>{euro(sums.totalCents)}</Text>
            </Pressable>
            <Button t={t} label="Πίσω στον λογαριασμό" onPress={() => { const id = target.id; setTarget(undefined); setBillId(id); setView("bill"); }} />
          </>
        ) : (
          <>
        {methods.length ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Τρόπος πληρωμής" style={{ flexDirection: "row", gap: 6 }}>
            {methods.map((m) => {
              const on = m.id === method?.id;
              const Icon = m.code === "cash" ? Banknote : CreditCard;
              return (
                <Pressable key={m.id} onPress={() => setMethodId(m.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flex: 1, height: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: on ? t.action : "transparent", borderWidth: 1, borderColor: on ? t.action : t.line }}>
                  <Icon {...ICON} color={on ? t.onAction : t.muted} />
                  <Text style={ty(12.5, "s", on ? t.onAction : t.muted)}>{m.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : <Text style={ty(13, "m", t.bad)}>! Δεν έχει οριστεί τρόπος πληρωμής για το ταμείο. Όρισέ τον από την κονσόλα.</Text>}
        <Pressable onPress={charge} disabled={busy || !sums.totalCents || !method} accessibilityRole="button" accessibilityState={{ disabled: busy || !sums.totalCents || !method }} style={({ pressed }) => ({ height: 56, borderRadius: 28, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: t.action, opacity: busy || !sums.totalCents || !method ? 0.35 : pressed ? 0.85 : 1 })}>
          <Text style={ty(16, "s", t.onAction)}>{busy ? "Περίμενε…" : "Είσπραξη"}</Text>
          <Text style={[ty(16, "b", t.onAction), num]}>{euro(sums.totalCents)}</Text>
        </Pressable>
          </>
        )}
      </View>

      {draft ? <OptionsSheet t={t} draft={draft} setDraft={setDraft} onDone={finishDraft} onClose={() => setDraft(undefined)} /> : null}
      {sendingOrder && order ? <OrderSendSheet t={t} session={session} draft={order} lines={cartOut()} totalCents={sums.totalCents} onClose={() => setSendingOrder(false)} onUnpaired={unpaired}
        onSent={() => { setSendingOrder(false); setOrder(undefined); setOrderNote(undefined); setCart([]); setSelected(undefined); setView("orders"); }} /> : null}
    </View>
  );
}
