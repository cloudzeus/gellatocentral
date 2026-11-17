import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { type Catalog, clearSession, createSale, getCatalog, loadSession, pair, type Product, reportResult, saveSession, type Session } from "./api";
import { c, euro } from "./theme";
import { isVivaResult, parseResult, saleUrl } from "./viva";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = φορτώνει
  useEffect(() => void loadSession().then(setSession), []);
  if (session === undefined) return <Centered><ActivityIndicator color={c.primary} /></Centered>;
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      {session ? <Pos session={session} onLogout={() => clearSession().then(() => setSession(null))} /> : <Pair onPaired={setSession} />}
    </SafeAreaView>
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => <View style={[s.root, { alignItems: "center", justifyContent: "center" }]}>{children}</View>;

// Πιστοποίηση συσκευής: διεύθυνση της εφαρμογής + κωδικός σύζευξης μίας χρήσης από την κονσόλα.
function Pair({ onPaired }: { onPaired: (s: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState("https://");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const session = await pair(baseUrl.trim().replace(/\/$/, ""), code.trim().toUpperCase());
      await saveSession(session); // το κλειδί μένει στο ασφαλές αποθετήριο της συσκευής
      onPaired(session);
    } catch (e) {
      Alert.alert("Δεν έγινε σύζευξη", e instanceof Error ? e.message : "Έλεγξε τη διεύθυνση και τον κωδικό.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.pair}>
      <View style={s.logoBox}><Image source={require("./assets/logo.png")} style={s.logo} resizeMode="contain" /></View>
      <Text style={s.h1}>Σύζευξη ταμείου</Text>
      <Text style={s.muted}>Γράψε τη διεύθυνση της εφαρμογής και τον 8ψήφιο κωδικό σύζευξης που σου έδωσε ο διαχειριστής. Ισχύει 15 λεπτά.</Text>
      <TextInput style={s.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" keyboardType="url" placeholder="https://app.gelatosystem.app" />
      <TextInput style={[s.input, { letterSpacing: 4, fontWeight: "800" }]} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="ΚΩΔΙΚΟΣ" />
      <Button label={busy ? "Έλεγχος…" : "Σύζευξη"} onPress={submit} disabled={busy || code.trim().length !== 8} />
    </View>
  );
}

function Pos({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState<string>();
  const [cat, setCat] = useState(0);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<string>(); // saleId που περιμένει το Viva Terminal

  useEffect(() => void getCatalog(session).then(setCatalog, (e) => setError(e.message)), [session]);

  // Επιστροφή από το Viva Terminal
  useEffect(() => {
    const sub = Linking.addEventListener("url", async ({ url }) => {
      if (!isVivaResult(url) || !pending) return;
      const r = parseResult(url);
      try {
        await reportResult(session, pending, { success: r.success, transactionId: r.transactionId, callback: url });
        if (r.success) setCart({});
        else Alert.alert("Η πληρωμή δεν ολοκληρώθηκε", "Η παραγγελία έμεινε στο ταμείο. Δοκίμασε ξανά.");
      } catch (e) {
        Alert.alert("Δεν ενημερώθηκε ο server", "Η πληρωμή έγινε αλλά η απόδειξη δεν καταχωρήθηκε. Μην ξαναχρεώσεις: ενημέρωσε τον υπεύθυνο.");
      } finally {
        setPending(undefined);
      }
    });
    return () => sub.remove();
  }, [pending, session]);

  if (error) return <Centered><Text style={s.h1}>Δεν φορτώνει ο κατάλογος</Text><Text style={s.muted}>{error}</Text><Button label="Αποσύνδεση συσκευής" onPress={onLogout} /></Centered>;
  if (!catalog) return <Centered><ActivityIndicator color={c.primary} /></Centered>;

  const products = catalog.categories.flatMap((x) => x.products);
  const lines = Object.entries(cart).map(([id, quantity]) => ({ product: products.find((p) => p.id === id)!, quantity })).filter((l) => l.product);
  const total = lines.reduce((sum, l) => sum + l.quantity * l.product.priceCents, 0);
  const add = (p: Product, d: number) => setCart((k) => { const q = (k[p.id] ?? 0) + d; const { [p.id]: _, ...rest } = k; return q > 0 ? { ...rest, [p.id]: q } : rest; });

  const pay = async (method: "CASH" | "CARD") => {
    try {
      const sale = await createSale(session, method, lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })));
      setPending(sale.saleId);
      // Και τα μετρητά περνούν από το Viva Terminal: εκεί γίνεται η σήμανση της απόδειξης.
      await Linking.openURL(saleUrl(sale));
    } catch (e) {
      setPending(undefined);
      Alert.alert("Δεν ξεκίνησε η πληρωμή", e instanceof Error ? e.message : "Δοκίμασε ξανά.");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View><Text style={s.h1}>Ταμείο</Text><Text style={s.muted}>{catalog.store} · {catalog.device.name} · σειρά {catalog.device.series}</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, padding: 12 }}>
        {catalog.categories.map((x, i) => (
          <Pressable key={x.id} onPress={() => setCat(i)} style={[s.chip, i === cat && { backgroundColor: c.primary }]}>
            <Text style={[s.chipText, i === cat && { color: "#fff" }]}>{x.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={catalog.categories[cat]?.products ?? []}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ gap: 12, padding: 12 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => add(item, 1)} style={s.product}>
            <Text style={s.productName}>{item.name}</Text>
            <Text style={s.price}>{euro(item.priceCents)}{cart[item.id] ? `   × ${cart[item.id]}` : ""}</Text>
          </Pressable>
        )}
      />
      <View style={s.cart}>
        {lines.map((l) => (
          <View key={l.product.id} style={s.line}>
            <Text style={{ flex: 1, fontWeight: "700", color: c.foreground }}>{l.product.name}</Text>
            <Pressable onPress={() => add(l.product, -1)} style={s.qty} accessibilityLabel="Λιγότερο"><Text style={s.qtyText}>−</Text></Pressable>
            <Text style={{ width: 28, textAlign: "center", fontWeight: "800" }}>{l.quantity}</Text>
            <Pressable onPress={() => add(l.product, 1)} style={s.qty} accessibilityLabel="Περισσότερο"><Text style={s.qtyText}>+</Text></Pressable>
          </View>
        ))}
        <View style={[s.line, { marginTop: 4 }]}><Text style={s.muted}>Σύνολο</Text><Text style={s.total}>{euro(total)}</Text></View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button label="Μετρητά" color={c.success} onPress={() => pay("CASH")} disabled={!total || !!pending} />
          <Button label="Κάρτα" onPress={() => pay("CARD")} disabled={!total || !!pending} />
        </View>
      </View>
    </View>
  );
}

function Button({ label, onPress, disabled, color = c.primary }: { label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.button, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  pair: { flex: 1, justifyContent: "center", gap: 12, padding: 24 },
  logoBox: { alignItems: "center", backgroundColor: c.primary, borderRadius: 14, padding: 16, marginBottom: 12 },
  logo: { height: 72, width: 200 },
  h1: { fontSize: 22, fontWeight: "800", color: c.foreground },
  muted: { fontSize: 14, color: c.muted },
  input: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: 14, fontSize: 16 },
  header: { paddingHorizontal: 16, paddingTop: 16 },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  chipText: { fontWeight: "700", color: c.foreground },
  product: { flex: 1, minHeight: 96, justifyContent: "space-between", padding: 14, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  productName: { fontSize: 15, fontWeight: "700", color: c.foreground },
  price: { fontSize: 18, fontWeight: "800", color: c.primary },
  cart: { gap: 8, padding: 16, backgroundColor: c.card, borderTopWidth: 1, borderColor: c.border },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  qty: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: c.border },
  qtyText: { fontSize: 20, fontWeight: "800", color: c.primary },
  total: { fontSize: 28, fontWeight: "800", color: c.foreground },
  button: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
