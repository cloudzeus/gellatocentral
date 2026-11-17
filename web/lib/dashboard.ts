import { euro } from "./money.ts";

/** Σημερινό σύνολο απέναντι στο χθεσινό της ίδιας ώρας, σε απλά λόγια. Κάτω από 3% διαφορά δεν είναι είδηση. */
export function compare(today: number, yesterday: number): { tone: "up" | "down" | "same" | "none"; pct: number; text: string } {
  if (!yesterday) return { tone: "none", pct: 0, text: "Χθες την ίδια ώρα δεν είχε πωλήσεις" };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  const ref = `χθες την ίδια ώρα (${euro(yesterday)})`;
  if (Math.abs(pct) < 3) return { tone: "same", pct, text: `Περίπου όσο ${ref}` };
  return pct > 0 ? { tone: "up", pct, text: `πάνω από ${ref}` } : { tone: "down", pct: -pct, text: `κάτω από ${ref}` };
}
