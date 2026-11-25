import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Linking, Pressable, SafeAreaView, ScrollView, Text, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { ApiError, type Catalog, checkResult, clearPending, clearSession, createSale, getCatalog, loadPending, loadSession, type Outcome, pair, type Pending, type Product, reportResult, savePending, saveSession, type Session } from "./api";
import { dark, euro, light, type Theme, tint } from "./theme";
import { amountCents, amountText, quickAmounts, retryDelayMs, totals, typeAmount } from "./till";
import { isVivaResult, parseResult, saleUrl } from "./viva";

// Κεντρικό ταμείο, πακέτο 1 (docs/design/spec-central-till-package-1.md): οθόνη πώλησης, μετρητά με ρέστα, καταστάσεις πληρωμής.
// Ό,τι το spec σημειώνει «νέο στον server» (αναμονή, έκπτωση, σημείωση, πελάτης, ταμίας, βάρδια) δεν εμφανίζεται καθόλου.

export default function App() {
  const t = useColorScheme() === "dark" ? dark : light;
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = φορτώνει
  useEffect(() => void loadSession().then(setSession), []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t === dark ? "light" : "dark"} />
      {session === undefined ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>
        : session ? <Till t={t} session={session} onUnpair={() => clearSession().then(() => clearPending()).then(() => setSession(null))} />
        : <Pair t={t} onPaired={setSession} />}
    </SafeAreaView>
  );
}

const num = { fontVariant: ["tabular-nums" as const] };

function Button({ t, label, onPress, primary, disabled, flex }: { t: Theme; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; flex?: boolean }) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={{ minHeight: 44, flex: flex ? 1 : undefined, paddingHorizontal: 16, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: primary ? t.action : "transparent", borderWidth: primary ? 0 : 1, borderColor: t.line, opacity: disabled ? 0.45 : 1 }}
    >
      <Text style={[{ fontSize: 14, fontWeight: "600", color: primary ? t.onAction : t.text, textAlign: "center" }, num]}>{label}</Text>
    </Pressable>
  );
}

// Πιστοποίηση συσκευής: διεύθυνση της εφαρμογής + κωδικός σύζευξης μίας χρήσης από την κονσόλα.
function Pair({ t, onPaired }: { t: Theme; onPaired: (s: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState("https://");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const session = await pair(baseUrl.trim().replace(/\/$/, ""), code.trim().toUpperCase());
      await saveSession(session); // το κλειδί μένει στο ασφαλές αποθετήριο της συσκευής
      onPaired(session);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Network request failed" ? e.message : "Δεν υπάρχει σύνδεση με αυτή τη διεύθυνση. Έλεγξέ την και δοκίμασε ξανά.");
    } finally {
      setBusy(false);
    }
  };
  const input = { minHeight: 48, borderRadius: 6, borderWidth: 1, borderColor: t.line, backgroundColor: t.panel, color: t.text, paddingHorizontal: 14, fontSize: 16 };
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View style={{ width: "100%", maxWidth: 420, gap: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: t.text }} accessibilityRole="header">Σύζευξη ταμείου</Text>
        <Text style={{ fontSize: 13, color: t.muted }}>Γράψε τη διεύθυνση της εφαρμογής και τον 8ψήφιο κωδικό σύζευξης που σου έδωσε ο διαχειριστής. Ισχύει 15 λεπτά.</Text>
        <TextInput style={input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://app.gelatosystem.app" placeholderTextColor={t.faint} accessibilityLabel="Διεύθυνση της εφαρμογής" />
        <TextInput style={[input, { letterSpacing: 4, fontWeight: "600" }]} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="ΚΩΔΙΚΟΣ" placeholderTextColor={t.faint} accessibilityLabel="Κωδικός σύζευξης" />
        {error ? <Text accessibilityLiveRegion="assertive" style={{ fontSize: 13, color: t.bad }}>! {error}</Text> : null}
        <Button t={t} primary label={busy ? "Έλεγχος…" : "Σύζευξη"} onPress={submit} disabled={busy || code.trim().length !== 8} />
      </View>
    </View>
  );
}

// ---- Καταστάσεις πληρωμής: ένα component, όλες οι περιπτώσεις ----

type Status =
  | { kind: "waiting" }
  | { kind: "paid"; series: string | null; aa: number | null }
  | { kind: "unknown"; attempt: number; checkedAt: Date }
  | { kind: "failed" }
  | { kind: "unverified" }
  | { kind: "resume" }
  | { kind: "offline" }
  | { kind: "unpaired" }
  | { kind: "blocked"; message: string };
type Tone = "neutral" | "ok" | "wait" | "bad";
type Action = { label: string; onPress: () => void; primary?: boolean };

const time = (d: Date | string) => new Date(d).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
// Κατάσταση = χρώμα + σύμβολο + λέξη, ποτέ μόνο χρώμα. shortcut: σύμβολα κειμένου αντί για εικονίδια, γιατί η εφαρμογή δεν έχει
// βιβλιοθήκη εικονιδίων και νέα εξάρτηση θέλει έγκριση· με βιβλιοθήκη γίνονται TriangleAlert / Clock / Check του spec.
const MARK: Record<Tone, string> = { neutral: "", ok: "✓", wait: "…", bad: "!" };

function StatusCard({ t, tone, label, title, text, note, actions, busy, summary }: { t: Theme; tone: Tone; label: string; title: string; text: string; note?: string; actions: Action[]; busy: boolean; summary?: string }) {
  const color = tone === "neutral" ? t.muted : t[tone];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: t.bg }}>
      {summary ? <Text style={[{ fontSize: 13, color: t.muted, marginBottom: 12 }, num]}>{summary}</Text> : null}
      <View accessibilityLiveRegion={tone === "bad" ? "assertive" : "polite"} style={{ width: "100%", maxWidth: 480, backgroundColor: t.panel, borderRadius: 6, borderWidth: 1, borderColor: t.line, borderTopWidth: 3, borderTopColor: color, padding: 20, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", height: 24, paddingHorizontal: 8, borderRadius: 4, backgroundColor: tone === "neutral" ? t.raised : tint(color) }}>
          {tone === "neutral" ? <ActivityIndicator size="small" color={t.muted} /> : <Text style={{ fontSize: 12, fontWeight: "600", color }}>{MARK[tone]}</Text>}
          <Text style={{ fontSize: 11.5, fontWeight: "600", color }}>{label}</Text>
        </View>
        <Text accessibilityRole="header" style={[{ fontSize: 15, fontWeight: "600", color: t.text }, num]}>{title}</Text>
        <Text style={[{ fontSize: 13, color: t.muted, lineHeight: 19 }, num]}>{text}</Text>
        {note ? <Text style={[{ fontSize: 11.5, color: t.muted }, num]}>{note}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          {actions.map((a) => <Button key={a.label} t={t} label={a.label} onPress={a.onPress} primary={a.primary} disabled={busy} />)}
        </View>
      </View>
    </View>
  );
}

function CashSheet({ t, totalCents, onContinue, onBack }: { t: Theme; totalCents: number; onContinue: () => void; onBack: () => void }) {
  const [given, setGiven] = useState("");
  const cents = amountCents(given);
  const missing = totalCents - cents;
  const row = (label: string, value: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ fontSize: 13, color: t.muted }}>{label}</Text><Text style={[{ fontSize: 14, fontWeight: "600", color: t.text }, num]}>{value}</Text></View>
  );
  const key = (k: string, label = k) => (
    <Pressable key={k} onPress={() => setGiven((g) => typeAmount(g, k))} accessibilityRole="button" accessibilityLabel={k === "⌫" ? "Σβήσιμο" : k === "," ? "Κόμμα" : k} style={{ flex: 1, height: 48, borderRadius: 6, backgroundColor: t.raised, alignItems: "center", justifyContent: "center" }}>
      <Text style={[{ fontSize: 18, fontWeight: "600", color: t.text }, num]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, flexDirection: "row", padding: 24, gap: 24, justifyContent: "center" }}>
      <View style={{ flex: 1, maxWidth: 420, gap: 12 }}>
        <Text style={{ fontSize: 13, color: t.muted }}>Έδωσε ο πελάτης</Text>
        <Text style={[{ fontSize: 30, fontWeight: "600", color: given ? t.text : t.faint }, num]}>{given || "0"} €</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button t={t} flex label="Ακριβώς" onPress={() => setGiven(amountText(totalCents))} />
          {quickAmounts(totalCents).map((a) => <Button key={a} t={t} flex label={`${a / 100} €`} onPress={() => setGiven(amountText(a))} />)}
        </View>
        {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [",", "0", "⌫"]].map((r) => <View key={r[0]} style={{ flexDirection: "row", gap: 8 }}>{r.map((k) => key(k))}</View>)}
      </View>
      <View style={{ flex: 1, maxWidth: 420, gap: 12, backgroundColor: t.panel, borderRadius: 6, borderWidth: 1, borderColor: t.line, padding: 20 }}>
        {row("Σύνολο", euro(totalCents))}
        {row("Έδωσε", euro(cents))}
        <View style={{ borderTopWidth: 1, borderTopColor: t.line, paddingTop: 12, gap: 4 }} accessibilityLiveRegion="polite">
          {missing > 0
            ? <Text style={[{ fontSize: 15, fontWeight: "600", color: t.bad }, num]}>! Λείπουν {euro(missing)}</Text>
            : <><Text style={{ fontSize: 13, color: t.muted }}>Ρέστα στον πελάτη</Text><Text style={[{ fontSize: 30, fontWeight: "600", color: t.ok }, num]}>{euro(-missing)}</Text></>}
        </View>
        <View style={{ flex: 1 }} />
        <Button t={t} primary label="Συνέχεια στο Viva Terminal για την απόδειξη" onPress={onContinue} disabled={missing > 0} />
        <Button t={t} label="Πίσω στην πώληση" onPress={onBack} />
      </View>
    </View>
  );
}

// ---- Ταμείο ----

function Till({ t, session, onUnpair }: { t: Theme; session: Session; onUnpair: () => void }) {
  const { width } = useWindowDimensions();
  const [catalog, setCatalog] = useState<Catalog>();
  const [online, setOnline] = useState(true);
  const [cat, setCat] = useState(0);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string>();
  const [methodId, setMethodId] = useState<string>();
  const [cash, setCash] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);

  const setPending = useCallback(async (p: Pending | null) => {
    pendingRef.current = p;
    setPendingState(p);
    await (p ? savePending(p) : clearPending());
  }, []);

  const loadCatalog = useCallback(() => {
    getCatalog(session).then(
      (c) => { setCatalog(c); setOnline(true); },
      (e) => { if (e instanceof ApiError && e.status === 401) setStatus({ kind: "unpaired" }); else { setOnline(false); setStatus((s) => s ?? { kind: "offline" }); } },
    );
  }, [session]);
  useEffect(loadCatalog, [loadCatalog]);

  // Μόνο μετρητά και κάρτα: το IRIS μέσα από το Viva Terminal δεν έχει επαληθευτεί σε αυτή τη σύνδεση (spec).
  const methods = useMemo(() => (catalog?.paymentMethods ?? []).filter((m) => m.code === "cash" || m.code === "card"), [catalog]);
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  const products = useMemo(() => catalog?.categories.flatMap((x) => x.products) ?? [], [catalog]);
  const lines = Object.entries(cart).map(([id, quantity]) => ({ product: products.find((p) => p.id === id)!, quantity })).filter((l) => l.product);
  const sums = totals(lines.map((l) => ({ ...l.product, quantity: l.quantity })));
  const add = (p: Product, d: number) => setCart((k) => { const q = (k[p.id] ?? 0) + d; const { [p.id]: _, ...rest } = k; return q > 0 ? { ...rest, [p.id]: q } : rest; });

  /** Κλείνει μια πληρωμή με ό,τι απάντησε ο server. Η εκκρεμότητα σβήνεται ΜΟΝΟ σε «πληρώθηκε» ή «δεν έγινε». */
  const settle = useCallback(async (ask: () => Promise<Outcome>, attempt = 0) => {
    setBusy(true);
    try {
      const o = await ask();
      setOnline(true);
      if (o.state === "paid") { await setPending(null); setStatus({ kind: "paid", series: o.series, aa: o.aa }); }
      else if (o.state === "failed") { await setPending(null); setStatus({ kind: "failed" }); }
      else setStatus({ kind: "unknown", attempt, checkedAt: new Date() });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "");
      if (err.status === 401) setStatus({ kind: "unpaired" });
      else if (err.status === 403) setStatus({ kind: "blocked", message: err.message || "Το ταμείο είναι κλειστό αυτή τη στιγμή." });
      else if (err.status === 409 && err.code === "verification_failed") setStatus({ kind: "unverified" });
      // η πώληση δεν περιμένει πια πληρωμή στον server (γύρισε σε πρόχειρο ή δεν υπάρχει)
      else if (err.status === 404 || (err.status === 409 && err.code === "invalid_state")) { await setPending(null); setStatus({ kind: "failed" }); }
      // δίκτυο, 502 ή οτιδήποτε άλλο: η πληρωμή μπορεί να έγινε, άρα ΔΕΝ είναι αποτυχία
      else { if (err.status === 0) setOnline(false); setStatus({ kind: "unknown", attempt, checkedAt: new Date() }); }
    } finally {
      setBusy(false);
    }
  }, [setPending]);

  const check = useCallback((attempt = 0) => {
    const p = pendingRef.current;
    if (!p) return;
    if (p.callback) { const r = parseResult(p.callback); void settle(() => reportResult(session, p.saleId, { success: r.success, transactionId: r.transactionId, callback: p.callback! }), attempt); }
    else void settle(() => checkResult(session, p.saleId), attempt);
  }, [session, settle]);

  // Επιστροφή από το Viva Terminal: το callback γράφεται πρώτα στη συσκευή, μετά πηγαίνει στον server.
  const onUrl = useCallback(async (url: string) => {
    const p = pendingRef.current;
    if (!isVivaResult(url) || !p) return;
    await setPending({ ...p, callback: url });
    check();
  }, [check, setPending]);

  // Στο άνοιγμα: πρώτα η αποθηκευμένη εκκρεμότητα, πριν φανεί το ταμείο. Καλύπτει και εκκίνηση από το callback της Viva.
  useEffect(() => {
    void (async () => {
      const p = await loadPending();
      if (!p) return;
      pendingRef.current = p;
      setPendingState(p);
      const url = await Linking.getInitialURL();
      if (url && isVivaResult(url)) await onUrl(url);
      else if (p.callback) check();
      else setStatus({ kind: "resume" });
    })();
    const sub = Linking.addEventListener("url", ({ url }) => void onUrl(url));
    return () => sub.remove();
    // μία φορά στο άνοιγμα· τα onUrl/check διαβάζουν την εκκρεμότητα από ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «Δεν ξέρουμε ακόμα»: ρωτάμε ξανά μόνοι μας, με αυξανόμενη αναμονή.
  useEffect(() => {
    if (status?.kind !== "unknown") return;
    const id = setTimeout(() => check(status.attempt + 1), retryDelayMs(status.attempt));
    return () => clearTimeout(id);
  }, [status, check]);

  // Το «πίσω» του Android δεν κλείνει πληρωμή σε εξέλιξη ή άγνωστη.
  const locked = status?.kind === "waiting" || status?.kind === "unknown" || status?.kind === "resume";
  useEffect(() => {
    if (!locked) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [locked]);

  const openViva = (p: Pending) => Linking.openURL(saleUrl(p)).catch(() => setStatus({ kind: "unknown", attempt: 0, checkedAt: new Date() }));

  const startPayment = async (withMethod = method) => {
    if (!withMethod || !lines.length) return;
    setCash(false);
    setBusy(true);
    try {
      const sale = await createSale(session, withMethod.id, lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })));
      setOnline(true);
      const p: Pending = { ...sale, methodName: withMethod.name, startedAt: new Date().toISOString(), items: lines.reduce((n, l) => n + l.quantity, 0) };
      await setPending(p); // πριν ανοίξει το Viva Terminal: αν κλείσει η εφαρμογή, η πληρωμή δεν χάνεται
      setStatus({ kind: "waiting" });
      await openViva(p);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "");
      const left = err.body.pending as (Pending & { issuedAt?: string }) | null | undefined;
      if (err.status === 0) { setOnline(false); setStatus({ kind: "offline" }); }
      else if (err.status === 401) setStatus({ kind: "unpaired" });
      else if (err.status === 403) setStatus({ kind: "blocked", message: err.message || "Το ταμείο είναι κλειστό αυτή τη στιγμή." });
      // υπάρχει ήδη πληρωμή σε εξέλιξη σε αυτό το ταμείο: τη συνεχίζουμε, δεν ξεκινάμε δεύτερη
      else if (err.status === 409 && left) { await setPending({ saleId: left.saleId, amountCents: left.amountCents, fiscalisationData: left.fiscalisationData, methodName: left.methodName ?? "", startedAt: left.issuedAt ?? new Date().toISOString(), items: 0 }); setStatus({ kind: "resume" }); }
      else setStatus({ kind: "failed" }); // η πώληση δεν ξεκίνησε: ο πελάτης δεν χρεώθηκε
    } finally {
      setBusy(false);
    }
  };

  const charge = () => (method?.code === "cash" ? setCash(true) : void startPayment());
  const backToSale = () => setStatus(undefined);

  if (status) {
    const amount = pending ? euro(pending.amountCents) : euro(sums.totalCents);
    const how = pending?.methodName || method?.name || "";
    const summary = pending ? `${amount} · ${how}${pending.items ? ` · ${pending.items} είδη` : ""} · ${time(pending.startedAt)}` : undefined;
    const card = (tone: Tone, label: string, title: string, text: string, actions: Action[], note?: string) => <StatusCard t={t} tone={tone} label={label} title={title} text={text} actions={actions} note={note} busy={busy} summary={summary} />;
    switch (status.kind) {
      case "waiting": return card("neutral", "Σε εξέλιξη", "Περιμένουμε το Viva Terminal", `${how} · ${amount}. Η οθόνη αλλάζει μόνη της μόλις τελειώσει.`, [{ label: "Viva Terminal", onPress: () => pending && void openViva(pending) }, { label: "Έλεγχος πληρωμής", onPress: () => check(), primary: true }]);
      case "paid": return card("ok", "Ολοκληρώθηκε", `Πληρώθηκε ${amount}`, `${how}${status.aa != null ? ` · απόδειξη ${status.series ?? ""} ${status.aa}` : ""}.`, [{ label: "Νέα πώληση", primary: true, onPress: () => { setCart({}); setSelected(undefined); backToSale(); } }]);
      case "unknown": return card("wait", "Περιμένει", "Δεν ξέρουμε ακόμα αν πληρώθηκε", "Η Viva δεν απάντησε. Ρωτάμε ξανά μόνοι μας. Μην χρεώσεις ξανά τον πελάτη.", [{ label: "Έλεγξε ξανά τώρα", primary: true, onPress: () => check(status.attempt) }], `Τελευταίος έλεγχος ${time(status.checkedAt)}`);
      case "failed": return card("bad", "Θέλει ενέργεια", "Η πληρωμή δεν έγινε", "Ο πελάτης δεν χρεώθηκε. Η πώληση είναι όπως την άφησες.", [
        ...(lines.length ? methods.map((m) => ({ label: m.code === "cash" ? "Με μετρητά" : "Ξανά με κάρτα", onPress: () => { setMethodId(m.id); setStatus(undefined); if (m.code === "cash") setCash(true); else void startPayment(m); } })) : []),
        { label: "Πίσω στην πώληση", onPress: backToSale, primary: true },
      ]);
      case "unverified": return card("bad", "Θέλει ενέργεια", "Η πληρωμή δεν έγινε", "Η Viva δεν επιβεβαίωσε την πληρωμή. Μην δώσεις το προϊόν ως πληρωμένο· φώναξε τον υπεύθυνο.", [{ label: "Πίσω στην πώληση", onPress: backToSale, primary: true }]);
      case "resume": return card("wait", "Περιμένει", "Έμεινε μια πληρωμή στη μέση", `Η εφαρμογή έκλεισε πριν μάθουμε αν πληρώθηκε: ${amount}${how ? `, ${how}` : ""}${pending ? `, ${time(pending.startedAt)}` : ""}.`, [{ label: "Έλεγξε αν πληρώθηκε", primary: true, onPress: () => check() }]);
      case "offline": return card("bad", "Θέλει ενέργεια", "Δεν υπάρχει σύνδεση", "Το ταμείο δεν μπορεί να βγάλει απόδειξη χωρίς internet. Η πώληση που έγραψες μένει στη συσκευή.", [
        ...(catalog ? [{ label: "Πίσω στην πώληση", onPress: backToSale }] : []),
        { label: "Δοκίμασε ξανά", primary: true, onPress: () => { if (catalog && lines.length) void startPayment(); else { setStatus(undefined); loadCatalog(); } } },
      ]);
      case "unpaired": return card("bad", "Θέλει ενέργεια", "Το ταμείο αποσυνδέθηκε", "Το κλειδί της συσκευής δεν ισχύει. Ζήτα νέο κωδικό σύζευξης από τον διαχειριστή.", [{ label: "Νέα σύζευξη", primary: true, onPress: onUnpair }]);
      case "blocked": return card("bad", "Θέλει ενέργεια", "Το ταμείο είναι κλειστό", status.message, [{ label: "Πίσω στην πώληση", onPress: backToSale, primary: true }]);
    }
  }
  if (!catalog) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>;
  if (cash) return <CashSheet t={t} totalCents={sums.totalCents} onContinue={() => void startPayment()} onBack={() => setCash(false)} />;

  const wide = width >= 1000;
  const panelW = width >= 700 ? 348 : 300;
  const gridW = width - panelW - (wide ? 200 : 0);
  const cols = Math.max(2, Math.min(6, Math.floor(gridW / 118)));
  const keyW = (gridW - 8 - 4 * (cols - 1)) / cols; // σταθερό πλάτος: η τελευταία, μισογεμάτη σειρά δεν απλώνει τα πλήκτρα της
  // shortcut: το χρώμα βγαίνει από τη θέση της κατηγορίας, γιατί ο server δεν έχει ακόμη πεδίο χρώματος· με το πεδίο διαβάζεται από τον κατάλογο.
  const colorOf = (i: number) => t.categories[1 + (i % (t.categories.length - 1))];
  const small = { fontSize: 11.5, color: t.muted };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ height: 48, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, backgroundColor: t.panel, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: t.text }}>Gelato System</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.muted }}>{catalog.store} · {catalog.device.name} · σειρά {catalog.device.series}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityLiveRegion="polite">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? t.ok : t.bad }} />
          <Text style={{ fontSize: 12.5, color: online ? t.muted : t.bad }}>{online ? "Συνδεδεμένο" : "! Χωρίς σύνδεση"}</Text>
        </View>
        <Text style={[{ fontSize: 12.5, color: t.muted }, num]}>{time(now)}</Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {wide ? (
          <View style={{ width: 200, backgroundColor: t.panel, borderRightWidth: 1, borderRightColor: t.line, padding: 8 }}>
            <View style={{ height: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: 6, backgroundColor: t.raised }}><Text style={{ fontSize: 13, fontWeight: "600", color: t.text }}>Πώληση</Text></View>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <FlatList
            key={cols} data={catalog.categories[cat]?.products ?? []} keyExtractor={(p) => p.id} numColumns={cols}
            columnWrapperStyle={{ gap: 4 }} contentContainerStyle={{ gap: 4, padding: 4 }}
            ListEmptyComponent={<Text style={{ padding: 16, fontSize: 13, color: t.muted }}>Αυτή η κατηγορία δεν έχει προϊόντα. Πρόσθεσέ τα από την κονσόλα, στα Προϊόντα.</Text>}
            renderItem={({ item }) => {
              const n = cart[item.id];
              return (
                <Pressable onPress={() => { add(item, 1); setSelected(item.id); }} accessibilityRole="button" accessibilityLabel={`${item.name}, ${euro(item.priceCents)}${n ? `, ${n} στο καλάθι` : ""}`} style={{ width: keyW, height: 92, borderRadius: 3, padding: 8, justifyContent: "space-between", backgroundColor: colorOf(cat), borderWidth: 2, borderColor: n ? t.text : "transparent" }}>
                  <Text numberOfLines={2} style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF", paddingRight: n ? 28 : 0 }}>{item.name}</Text>
                  <Text style={[{ fontSize: 13, fontWeight: "600", color: "#FFFFFF", textAlign: "right" }, num]}>{euro(item.priceCents)}</Text>
                  {n ? <View style={{ position: "absolute", top: 4, right: 4, minWidth: 24, height: 20, paddingHorizontal: 4, borderRadius: 3, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}><Text style={[{ fontSize: 11.5, fontWeight: "600", color: t.text }, num]}>× {n}</Text></View> : null}
                </Pressable>
              );
            }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, backgroundColor: t.panel, borderTopWidth: 1, borderTopColor: t.line }} contentContainerStyle={{ minWidth: "100%" }}>
            {catalog.categories.map((x, i) => (
              <Pressable key={x.id} onPress={() => setCat(i)} accessibilityRole="tab" accessibilityState={{ selected: i === cat }} style={{ flex: 1, minWidth: 110, height: 68, justifyContent: "center", paddingHorizontal: 12, borderTopWidth: 3, borderTopColor: colorOf(i), backgroundColor: i === cat ? t.raised : "transparent" }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "600", color: t.text }}>{x.name}</Text>
                <Text style={[small, num]}>{x.products.length} είδη</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={{ width: panelW, backgroundColor: t.panel, borderLeftWidth: 1, borderLeftColor: t.line }}>
          <View style={{ height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: t.line }}>
            <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "600", color: t.text }}>Πώληση</Text>
            <Text style={small}>{lines.reduce((n, l) => n + l.quantity, 0)} είδη</Text>
          </View>
          <ScrollView style={{ flex: 1 }}>
            {lines.length === 0 ? <Text style={{ padding: 12, fontSize: 13, color: t.muted }}>Πάτα ένα προϊόν για να ξεκινήσεις την πώληση.</Text> : null}
            {lines.map((l, i) => {
              const on = selected === l.product.id;
              return (
                <Pressable key={l.product.id} onPress={() => setSelected(on ? undefined : l.product.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: on ? t.raised : "transparent", borderLeftWidth: 2, borderLeftColor: on ? t.action : "transparent", borderBottomWidth: 1, borderBottomColor: t.line }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={[small, num, { width: 16 }]}>{i + 1}</Text>
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: t.text }}>{l.product.name}</Text>
                    <Text style={[{ fontSize: 13, fontWeight: "600", color: t.text }, num]}>{euro(l.quantity * l.product.priceCents)}</Text>
                  </View>
                  <Text style={[small, num, { marginLeft: 24 }]}>{l.quantity} × {euro(l.product.priceCents)}</Text>
                  {on ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginLeft: 24 }}>
                      <Pressable onPress={() => add(l.product, -1)} accessibilityRole="button" accessibilityLabel={`Ένα λιγότερο ${l.product.name}`} style={{ width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 18, fontWeight: "600", color: t.text }}>−</Text></Pressable>
                      <Text style={[{ minWidth: 28, textAlign: "center", fontSize: 14, fontWeight: "600", color: t.text }, num]}>{l.quantity}</Text>
                      <Pressable onPress={() => add(l.product, 1)} accessibilityRole="button" accessibilityLabel={`Ένα ακόμη ${l.product.name}`} style={{ width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 18, fontWeight: "600", color: t.text }}>+</Text></Pressable>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: t.line }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={small}>Καθαρή αξία</Text><Text style={[small, num]}>{euro(sums.netCents)}</Text></View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={small}>ΦΠΑ</Text><Text style={[small, num]}>{euro(sums.vatCents)}</Text></View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}><Text style={{ fontSize: 13, color: t.text }}>Σύνολο</Text><Text style={[{ fontSize: 24, fontWeight: "600", color: t.text }, num]}>{euro(sums.totalCents)}</Text></View>
            {methods.length ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Τρόπος πληρωμής" style={{ flexDirection: "row", borderRadius: 6, borderWidth: 1, borderColor: t.line, overflow: "hidden" }}>
                {methods.map((m) => (
                  <Pressable key={m.id} onPress={() => setMethodId(m.id)} accessibilityRole="radio" accessibilityState={{ checked: m.id === method?.id }} style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: m.id === method?.id ? t.raised : "transparent" }}>
                    <Text style={{ fontSize: 13, fontWeight: m.id === method?.id ? "600" : "500", color: m.id === method?.id ? t.text : t.muted }}>{m.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : <Text style={{ fontSize: 12.5, color: t.bad }}>! Δεν έχει οριστεί τρόπος πληρωμής για το ταμείο. Όρισέ τον από την κονσόλα.</Text>}
            <Button t={t} primary label={busy ? "Περίμενε…" : `Είσπραξη ${euro(sums.totalCents)}`} onPress={charge} disabled={busy || !sums.totalCents || !method} />
          </View>
        </View>
      </View>
    </View>
  );
}
