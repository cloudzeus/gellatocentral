// Οθόνη κουζίνας (KDS): δελτία ανά γύρο × σταθμό, τσεκ ανά είδος, «Έτοιμο» με αναίρεση 10″, σύνολα αριστερά,
// «Έρχονται» από το «Μετά» κάτω. Mockup: docs/analysis/mockups/kitchen-display.html (εγκεκριμένο).
import { Check, LogOut } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { ApiError, type Session } from "./api";
import { ageLevel, STATION_NAME, totalsOf, waiting } from "./kitchen";
import { type Board, bump, getBoard, type KTicket, setReady, type Station } from "./kitchen-api";
import { type Theme, tint, ty } from "./theme";

const num = { fontVariant: ["tabular-nums" as const] };
const minsSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
const POLL_MS = 5_000;
const UNDO_MS = 10_000;

export function KitchenScreen({ t, session, onUnpair }: { t: Theme; session: Session; onUnpair: () => void }) {
  const [board, setBoard] = useState<Board>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Station | "ALL" | undefined>(); // undefined = ο σταθμός της οθόνης
  const [focus, setFocus] = useState<string>(); // είδος από τα σύνολα που φωτίζεται στα δελτία
  const [undo, setUndo] = useState<{ title: string; waiter: string | null; lineIds: string[]; until: number }>();
  const [now, setNow] = useState(() => Date.now());
  // τσεκ που στάλθηκαν και δεν τα έχει δει ακόμα ο server: δείχνονται αμέσως
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { width } = useWindowDimensions();

  // πρώτη φορά που φάνηκε κάθε δελτίο: «Νέο» για ένα λεπτό (όχι στο πρώτο φόρτωμα)
  const [firstSeen, setFirstSeen] = useState<Record<string, number>>({});
  const load = useCallback(() => getBoard(session).then((b) => {
    setFirstSeen((m) => { const first = !Object.keys(m).length; const n: Record<string, number> = {}; for (const x of b.tickets) n[x.key] = m[x.key] ?? (first ? 0 : Date.now()); return n; });
    setBoard(b); setError(undefined); setPending({});
  }, (e) => {
    if (e instanceof ApiError && e.status === 401) onUnpair(); else setError(e instanceof ApiError && e.status === 0 ? "Χωρίς σύνδεση· τα δελτία ίσως δεν είναι τα τελευταία" : "Ο server δεν απάντησε· ξαναδοκιμάζω");
  }), [session, onUnpair]);
  useEffect(() => { void load(); const id = setInterval(load, POLL_MS); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  if (!board) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}><Text style={ty(16, "m", error ? t.bad : t.muted)}>{error ?? "Φορτώνει τα δελτία…"}</Text></View>;

  const mine = filter ?? board.device.station ?? "ALL";
  const shown = board.tickets.filter((x) => mine === "ALL" || x.station === mine)
    .map((x) => ({ ...x, lines: x.lines.map((l) => (l.id in pending ? { ...l, ready: pending[l.id] } : l)) }));
  const totals = totalsOf(shown);
  const w = waiting(shown);
  const count = (s: Station) => board.tickets.filter((x) => x.station === s).length;
  const coming = board.coming.filter((x) => mine === "ALL" || x.station === mine);
  const { kdsWarnMin: warn, kdsLateMin: late } = board.device;
  const sumW = width >= 900 ? 220 : 0; // σε μικρή οθόνη χωρίς στήλη συνόλων
  const cols = Math.max(1, Math.floor((width - sumW - 12) / 260));
  const cardW = (width - sumW - 24 - 10 * (cols - 1)) / cols;

  const toggle = (lineId: string, ready: boolean) => {
    setPending((p) => ({ ...p, [lineId]: ready }));
    setReady(session, [lineId], ready).catch(() => setError("Δεν αποθηκεύτηκε· πάτα ξανά"));
  };
  const done = async (tk: KTicket) => {
    try {
      const ids = await bump(session, tk.roundId, tk.station);
      setUndo({ title: tk.title, waiter: tk.waiter, lineIds: ids, until: now + UNDO_MS });
      await load();
    } catch { setError("Το «Έτοιμο» δεν πέρασε· πάτα ξανά"); }
  };
  const revert = async () => {
    if (!undo) return;
    setUndo(undefined);
    if (undo.lineIds.length) await setReady(session, undo.lineIds, false).catch(() => setError("Η αναίρεση δεν πέρασε"));
    await load();
  };
  const leave = () => Alert.alert("Βγάλε την οθόνη από το κατάστημα;", "Για να ξαναμπεί θέλει νέο κωδικό σύζευξης από την κονσόλα.", [{ text: "Άκυρο", style: "cancel" }, { text: "Βγάλ' την", style: "destructive", onPress: onUnpair }]);

  const seg = (key: Station | "ALL", label: string) => (
    <Pressable key={key} onPress={() => setFilter(key)} accessibilityRole="button" accessibilityState={{ selected: mine === key }}
      style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 9, justifyContent: "center", backgroundColor: mine === key ? t.action : "transparent" }}>
      <Text style={[ty(15, "s", mine === key ? t.onAction : t.muted), num]}>{label}</Text>
    </Pressable>
  );
  const clock = new Date(now).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ minHeight: 64, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <Text style={ty(20, "b", t.text)}>{board.device.station ? STATION_NAME[board.device.station] : board.device.name}</Text>
        <View style={{ flexDirection: "row", backgroundColor: t.card, borderRadius: 12, padding: 4, gap: 2 }}>
          {seg("KITCHEN", `Κουζίνα · ${count("KITCHEN")}`)}{seg("BAR", `Bar · ${count("BAR")}`)}{seg("ALL", "Όλα")}
        </View>
        <Text style={[ty(14, "m", t.muted), num]}>Σε αναμονή <Text style={ty(14, "s", t.text)}>{w.tickets}</Text> δελτία · <Text style={ty(14, "s", t.text)}>{w.items}</Text> είδη</Text>
        {board.today.count ? <Text style={[ty(14, "m", t.muted), num]}>· Μέσος χρόνος σήμερα <Text style={ty(14, "s", board.today.avgMin > warn ? t.wait : t.ok)}>{Math.round(board.today.avgMin)}′</Text></Text> : null}
        <Text style={[ty(22, "s", t.text), num, { marginLeft: "auto" }]}>{clock}</Text>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Βγάλε τη συσκευή" hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><LogOut size={20} strokeWidth={1.75} color={t.faint} /></Pressable>
      </View>
      {error ? <Text accessibilityLiveRegion="assertive" style={[ty(13.5, "s", t.bad), { paddingHorizontal: 16, paddingTop: 8 }]}>! {error}</Text> : null}

      <View style={{ flex: 1, flexDirection: "row" }}>
        {sumW ? (
          <View style={{ width: sumW, borderRightWidth: 1, borderRightColor: t.line, padding: 12, gap: 4, overflow: "hidden" }}>
            <Text style={[ty(13, "s", t.muted), { marginBottom: 4 }]}>Να φτιαχτούν συνολικά</Text>
            {totals.slice(0, 10).map((x) => {
              const on = focus === x.name;
              return (
                <Pressable key={x.name} onPress={() => setFocus(on ? undefined : x.name)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 10, backgroundColor: on ? t.action : t.panel }}>
                  <Text style={[ty(20, "b", on ? t.onAction : t.text), num, { minWidth: 28 }]}>{x.quantity}</Text>
                  <Text numberOfLines={2} style={[ty(15, "m", on ? t.onAction : t.text), { flex: 1 }]}>{x.name}</Text>
                </Pressable>
              );
            })}
            {totals.length ? <Text style={[ty(12, "m", t.faint), { marginTop: 6 }]}>Πάτα ένα είδος: φωτίζεται σε όλα τα δελτία που το έχουν.</Text> : null}
          </View>
        ) : null}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "flex-start", flexGrow: 1 }}>
          {shown.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 80 }}>
              <Check size={40} strokeWidth={1.75} color={t.ok} />
              <Text style={ty(20, "s", t.text)}>Δεν περιμένει τίποτα</Text>
              <Text style={ty(14, "m", t.muted)}>Ο επόμενος γύρος εμφανίζεται εδώ μόλις τον στείλει ο σερβιτόρος.</Text>
            </View>
          ) : shown.map((tk) => {
            const age = minsSince(tk.sentAt, now);
            const lvl = ageLevel(age, warn, late);
            const c = lvl === "bad" ? t.bad : lvl === "wait" ? t.wait : t.ok;
            const isNew = now - (firstSeen[tk.key] ?? 0) < 60_000;
            const live = tk.lines.filter((l) => !l.voided);
            const ready = live.filter((l) => l.ready).length;
            return (
              <View key={tk.key} style={{ width: cardW, borderRadius: 14, backgroundColor: t.panel, borderTopWidth: 6, borderTopColor: c, overflow: "hidden", borderWidth: isNew ? 2 : 0, borderColor: t.categories[4] }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
                  <Text style={ty(26, "b", t.text)}>{tk.title}</Text>
                  <Text style={[ty(22, "b", c), num, { marginLeft: "auto" }]}>{age}′</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
                  {isNew ? <Text style={[ty(12, "s", t.ink), { backgroundColor: t.categories[4], borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }]}>Νέο</Text> : null}
                  <Text numberOfLines={1} style={ty(13, "m", t.muted)}>Γύρος {tk.number}{tk.waiter ? ` · ${tk.waiter}` : ""}{mine === "ALL" ? ` · ${STATION_NAME[tk.station]}` : ""}</Text>
                </View>
                <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
                  {tk.lines.map((l, i) => {
                    const hl = focus === l.name && !l.ready && !l.voided;
                    const strike = l.ready ? { textDecorationLine: "line-through" as const } : null;
                    return (
                      <Pressable key={l.id} disabled={l.voided} onPress={() => toggle(l.id, !l.ready)} accessibilityRole="checkbox" accessibilityState={{ checked: l.ready, disabled: l.voided }}
                        accessibilityLabel={`${l.quantity} ${l.name}${l.options ? `, ${l.options}` : ""}${l.note ? `, ${l.note}` : ""}${l.voided ? ", ακυρώθηκε" : ""}`}
                        style={({ pressed }) => ({ flexDirection: "row", gap: 10, paddingVertical: 8, minHeight: 48, alignItems: "flex-start", borderTopWidth: i ? 1 : 0, borderTopColor: t.line, marginHorizontal: -12, paddingHorizontal: 12, backgroundColor: l.voided ? tint(t.bad) : hl ? t.raised : pressed ? t.card : "transparent" })}>
                        <View style={{ width: 24, height: 24, borderRadius: 12, marginTop: 1, borderWidth: 2, borderColor: l.ready ? t.ok : t.line, backgroundColor: l.ready ? t.ok : "transparent", alignItems: "center", justifyContent: "center" }}>
                          {l.ready ? <Check size={14} strokeWidth={3} color={t.ink} /> : null}
                        </View>
                        <Text style={[ty(20, "b", l.voided ? t.bad : l.ready ? t.faint : t.text), num, { minWidth: 26 }, strike, l.voided ? { textDecorationLine: "line-through" } : null]}>{l.quantity}</Text>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[ty(17, "s", l.voided ? t.bad : l.ready ? t.faint : t.text), strike, l.voided ? { textDecorationLine: "line-through" } : null]}>{l.name}</Text>
                          {l.voided ? <Text style={ty(14, "s", t.bad)}>Ακυρώθηκε</Text> : null}
                          {l.options && !l.voided ? <Text style={[ty(14, "m", l.ready ? t.faint : t.muted), strike]}>{l.options}</Text> : null}
                          {l.note && !l.voided ? <Text style={ty(14, "s", l.ready ? t.faint : t.wait)}>{l.note}</Text> : null}
                        </View>
                        {l.seat ? <Text style={[ty(12, "m", t.muted), { backgroundColor: t.card, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 }]}>Θ{l.seat}</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ padding: 12, paddingTop: 6 }}>
                  <Pressable onPress={() => void done(tk)} accessibilityRole="button" accessibilityLabel={`Έτοιμο ${tk.title}`}
                    style={({ pressed }) => ({ minHeight: 52, borderRadius: 12, backgroundColor: t.action, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.85 : 1 })}>
                    <Text style={ty(17, "b", t.onAction)}>Έτοιμο</Text>
                    {ready ? <Text style={[ty(14, "m", t.onAction), num, { opacity: 0.6 }]}>{ready} από {live.length} έτοιμα</Text> : null}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {coming.length ? (
        <View style={{ minHeight: 60, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.panel, flexDirection: "row", alignItems: "center", paddingLeft: 16 }}>
          <Text style={[ty(13, "s", t.wait), { marginRight: 10 }]}>Έρχονται · στο «Μετά»</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16, alignItems: "center" }}>
            {coming.map((x) => (
              <Text key={x.key} style={[ty(14, "m", t.muted), num, { backgroundColor: tint(t.wait), borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }]}>
                <Text style={ty(14, "b", t.text)}>{x.title}</Text> · {x.items.map((i) => `${i.quantity} ${i.name}`).join(", ")} · {minsSince(x.since, now)}′
              </Text>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {undo && now <= undo.until ? (
        <View style={{ position: "absolute", alignSelf: "center", bottom: coming.length ? 76 : 16, minHeight: 56, borderRadius: 14, backgroundColor: t.action, flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 18, paddingRight: 8, elevation: 6 }}>
          <Text style={ty(15, "s", t.onAction)}>{undo.title} έτοιμο{undo.waiter ? ` · ειδοποιήθηκε ${undo.waiter}` : ""}</Text>
          <Pressable onPress={() => void revert()} accessibilityRole="button" style={{ minHeight: 44, borderRadius: 10, backgroundColor: t.ink, paddingHorizontal: 14, justifyContent: "center" }}>
            <Text style={[ty(14, "s", t.text), num]}>Αναίρεση · {Math.max(0, Math.ceil((undo.until - now) / 1000))}″</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
