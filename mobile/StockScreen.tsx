// Απόθεμα για τον αποθηκάριο / chef: τι έχει κάθε αποθήκη του καταστήματος, τι είναι χαμηλά, τι λήγει, πού βρίσκεται.
// Ύφος: docs/analysis/mockups/staff-roles-shifts.html (ενότητα αποθηκάριου).
import { AlertTriangle, Clock, MapPin, RefreshCw, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError, type Session } from "./api";
import type { Spot } from "./receiving";
import { getStock, setSpot, type StockData, type StockItem } from "./receiving-api";
import { type Theme, tint, ty } from "./theme";
import { Btn, Seg } from "./TransactionsScreen";

const num = { fontVariant: ["tabular-nums" as const] };
const ICON = { size: 18, strokeWidth: 1.75 };
const fail = (e: unknown) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : e instanceof ApiError && e.status === 0 ? "Δεν υπάρχει σύνδεση. Δοκίμασε ξανά." : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
const dm = (iso: string) => new Date(iso).toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit" });

/** Ποσότητα σε kg / l / τεμ. (βασικές μονάδες: mg, ml, τεμάχια). */
export function amount(base: number, dimension: string) {
  if (dimension === "mass") return `${(base / 1_000_000).toLocaleString("el-GR", { maximumFractionDigits: 2 })} kg`;
  if (dimension === "volume") return `${(base / 1000).toLocaleString("el-GR", { maximumFractionDigits: 2 })} l`;
  return `${base.toLocaleString("el-GR")} τεμ.`;
}

/** Φύλλο «Πού μπαίνει;»: διαλέγεις υπάρχουσα θέση της αποθήκης ή γράφεις νέα. */
export function SpotSheet({ t, session, item, spots, onDone, onClose }: { t: Theme; session: Session; item: { genericItemId: string; warehouseId: string; name: string; spot?: Spot | null }; spots: Spot[]; onDone: (s: Spot) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = (body: { spotId?: string; name?: string }) => {
    setBusy(true); setError(undefined);
    setSpot(session, { genericItemId: item.genericItemId, warehouseId: item.warehouseId, ...body }).then(onDone, (e) => setError(fail(e))).finally(() => setBusy(false));
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View style={{ backgroundColor: t.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14, maxHeight: "80%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <MapPin {...ICON} color={t.text} />
            <View style={{ flex: 1 }}><Text style={ty(16, "s", t.text)} numberOfLines={1}>Πού μπαίνει: {item.name}</Text><Text style={ty(12.5, "m", t.muted)}>Θα το δείχνει σε κάθε επόμενη παραλαβή και στο απόθεμα</Text></View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Κλείσιμο" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><X {...ICON} color={t.muted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} keyboardShouldPersistTaps="handled">
            {spots.map((s) => { const on = s.id === item.spot?.id; return (
              <Pressable key={s.id} disabled={busy} onPress={() => save({ spotId: s.id })} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: "center", backgroundColor: on ? t.text : pressed ? t.raised : t.card })}>
                <Text style={ty(14, "s", on ? t.bg : t.text)}>{s.name}</Text>
              </Pressable>); })}
            {!spots.length ? <Text style={ty(13, "m", t.muted)}>Η αποθήκη δεν έχει ακόμα θέσεις. Γράψε την πρώτη.</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput value={name} onChangeText={setName} placeholder="Νέα θέση, π.χ. Ψυγείο 1 · Ράφι 2" placeholderTextColor={t.faint} maxLength={60} accessibilityLabel="Όνομα νέας θέσης"
              style={[ty(15, "m", t.text), { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: t.card, paddingHorizontal: 14 }]} />
            <Btn t={t} label={busy ? "…" : "Ορισμός"} primary disabled={busy || !name.trim()} onPress={() => save({ name: name.trim() })} />
          </View>
          {error ? <Text style={ty(13, "s", t.bad)}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

type Filter = "all" | "low" | "expiring" | "nospot";

export function StockView({ t, session, width, onUnpaired }: { t: Theme; session: Session; width: number; onUnpaired: () => void }) {
  const [data, setData] = useState<StockData>();
  const [error, setError] = useState<string>();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [wh, setWh] = useState<string>();
  const [editing, setEditing] = useState<StockItem>();
  const load = useCallback(() => {
    getStock(session).then((d) => { setData(d); setWh((w) => w ?? d.warehouses[0]?.id); }, (e) => (e instanceof ApiError && e.status === 401 ? onUnpaired() : setError(fail(e))));
  }, [session, onUnpaired]);
  useEffect(load, [load]);

  if (error) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}><Text style={[ty(15, "s", t.text), { textAlign: "center" }]}>{error}</Text><Btn t={t} label="Δοκίμασε ξανά" Icon={RefreshCw} onPress={() => { setError(undefined); load(); }} /></View>;
  if (!data) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={t.muted} /></View>;

  const inWh = data.items.filter((i) => i.warehouseId === wh);
  const counts = { low: inWh.filter((i) => i.low).length, expiring: inWh.filter((i) => i.expiring.length).length, nospot: inWh.filter((i) => !i.spot).length };
  const needle = q.trim().toLowerCase();
  const shown = inWh.filter((i) => (filter === "low" ? i.low : filter === "expiring" ? i.expiring.length > 0 : filter === "nospot" ? !i.spot : true) && (!needle || i.name.toLowerCase().includes(needle) || i.spot?.name.toLowerCase().includes(needle)));
  const spots = data.warehouses.find((w) => w.id === wh)?.spots ?? [];
  const cols = width >= 900 ? 2 : 1;

  const stat = (label: string, n: number, color: string, f: Filter) => (
    <Pressable onPress={() => setFilter(filter === f ? "all" : f)} accessibilityRole="button" accessibilityState={{ selected: filter === f }}
      style={({ pressed }) => ({ flex: 1, minHeight: 64, borderRadius: 14, padding: 12, gap: 2, backgroundColor: filter === f ? tint(color) : pressed ? t.raised : t.card, borderWidth: filter === f ? 1 : 0, borderColor: color })}>
      <Text style={[ty(22, "s", n ? color : t.muted), num]}>{n}</Text>
      <Text style={ty(12, "m", t.muted)} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={[ty(20, "s", t.text), { flex: 1 }]}>Απόθεμα</Text>
          <Pressable onPress={load} accessibilityRole="button" accessibilityLabel="Ανανέωση" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><RefreshCw {...ICON} color={t.muted} /></Pressable>
        </View>
        {data.warehouses.length > 1 ? <Seg t={t} value={wh ?? ""} onChange={setWh} items={data.warehouses.map((w) => [w.id, w.name] as [string, string])} /> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {stat("Κάτω από το ελάχιστο", counts.low, t.bad, "low")}
          {stat("Λήγουν σε 3 ημέρες", counts.expiring, t.wait, "expiring")}
          {stat("Χωρίς θέση", counts.nospot, t.muted, "nospot")}
        </View>
        <View style={{ height: 48, borderRadius: 12, backgroundColor: t.card, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 }}>
          <Search {...ICON} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Υλικό ή θέση" placeholderTextColor={t.faint} accessibilityLabel="Αναζήτηση υλικού" style={[ty(15, "m", t.text), { flex: 1 }]} />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8, flexDirection: "row", flexWrap: "wrap" }}>
        {shown.map((i) => (
          <View key={i.genericItemId} style={{ width: cols === 2 ? "49.4%" : "100%", borderRadius: 14, backgroundColor: t.card, padding: 14, gap: 8, borderLeftWidth: 3, borderLeftColor: i.low ? t.bad : i.expiring.length ? t.wait : "transparent" }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={[ty(15, "s", t.text), { flex: 1 }]} numberOfLines={2}>{i.name}</Text>
              <Text style={[ty(15, "s", i.low ? t.bad : t.text), num]}>{amount(i.qty, i.dimension)}</Text>
            </View>
            {i.low && i.min != null ? <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><AlertTriangle size={14} strokeWidth={2} color={t.bad} /><Text style={[ty(12.5, "m", t.bad), num]}>Ελάχιστο {amount(i.min, i.dimension)} · λείπουν {amount(i.min - i.qty, i.dimension)}. Πες το στον υπεύθυνο παραγγελιών.</Text></View> : null}
            {i.expiring.map((x) => <View key={x.expiresAt} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Clock size={14} strokeWidth={2} color={t.wait} /><Text style={[ty(12.5, "m", t.wait), num]}>{amount(x.qty, i.dimension)} λήγουν {dm(x.expiresAt)} · χρησιμοποίησέ τα πρώτα</Text></View>)}
            <Pressable onPress={() => setEditing(i)} accessibilityRole="button" accessibilityLabel={`Θέση για ${i.name}`}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, alignSelf: "flex-start", paddingHorizontal: 10, borderRadius: 10, backgroundColor: pressed ? t.raised : t.panel })}>
              <MapPin size={14} strokeWidth={2} color={i.spot ? t.text : t.muted} />
              <Text style={ty(13, "s", i.spot ? t.text : t.muted)}>{i.spot ? i.spot.name : "Όρισε θέση"}</Text>
            </Pressable>
          </View>
        ))}
        {!shown.length ? <Text style={[ty(14, "m", t.muted), { padding: 8 }]}>{inWh.length ? "Τίποτα με αυτό το φίλτρο." : "Η αποθήκη δεν έχει απόθεμα ακόμα."}</Text> : null}
      </ScrollView>
      {editing ? <SpotSheet t={t} session={session} item={editing} spots={spots} onClose={() => setEditing(undefined)} onDone={() => { setEditing(undefined); load(); }} /> : null}
    </View>
  );
}
