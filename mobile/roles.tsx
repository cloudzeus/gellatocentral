// Πώς φαίνεται ο ρόλος της βάρδιας στη συσκευή: χρώμα και εικονίδιο ανά ομάδα, και τι μενού ανοίγει.
import { BriefcaseBusiness, ChefHat, ConciergeBell, type LucideIcon, Warehouse } from "lucide-react-native";
import { Text, View } from "react-native";
import type { View as RoleView } from "./shift-api";
import { type Theme, ty } from "./theme";

export type Group = "service" | "kitchen" | "warehouse" | "management";
const LOOK: Record<Group, { label: string; Icon: LucideIcon; color: number }> = {
  service: { label: "Σέρβις", Icon: ConciergeBell, color: 3 },
  kitchen: { label: "Κουζίνα", Icon: ChefHat, color: 6 },
  warehouse: { label: "Αποθήκη", Icon: Warehouse, color: 4 },
  management: { label: "Διοίκηση", Icon: BriefcaseBusiness, color: 1 },
};
export const groupLook = (t: Theme, g: string | null | undefined) => { const l = LOOK[(g ?? "") as Group]; return l ? { ...l, bg: t.categories[l.color] } : null; };

export const VIEW_NAME: Record<RoleView, string> = { sale: "Πώληση", tables: "Τραπέζια", reservations: "Κρατήσεις", orders: "Παραγγελίες", transactions: "Συναλλαγές", receiving: "Παραλαβή", stock: "Απόθεμα" };
/** «Ανοίγει: Παραλαβή · Απόθεμα» για να ξέρει ο εργαζόμενος τι θα δει πριν μπει. */
export const opens = (views: readonly RoleView[], cash: boolean) => (views.length ? views.map((v) => VIEW_NAME[v]).join(" · ") : "Μόνο βάρδια") + (cash ? " · Συρτάρι" : "");

/** Ετικέτα ρόλου: παστέλ χρώμα ομάδας, σκούρο κείμενο, εικονίδιο. Ίδια σε κάθε οθόνη. */
export function RoleBadge({ t, name, group, size = "m" }: { t: Theme; name: string; group?: string | null; size?: "s" | "m" | "l" }) {
  const look = groupLook(t, group);
  const Icon = look?.Icon;
  const px = size === "l" ? 14 : size === "s" ? 8 : 10;
  return (
    <View accessibilityLabel={`Ρόλος ${name}`} style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingHorizontal: px, minHeight: size === "l" ? 36 : size === "s" ? 22 : 28, borderRadius: 999, backgroundColor: look?.bg ?? t.raised }}>
      {Icon ? <Icon size={size === "l" ? 18 : 14} strokeWidth={2} color={t.ink} /> : null}
      <Text numberOfLines={1} style={ty(size === "l" ? 15 : size === "s" ? 11.5 : 13, "s", look ? t.ink : t.text)}>{name}</Text>
    </View>
  );
}
