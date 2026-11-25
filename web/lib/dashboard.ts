import { euro } from "./money.ts";

/** Σημερινό σύνολο απέναντι στο χθεσινό της ίδιας ώρας, σε απλά λόγια. Κάτω από 3% διαφορά δεν είναι είδηση. */
export function compare(today: number, yesterday: number): { tone: "up" | "down" | "same" | "none"; pct: number; text: string } {
  if (!yesterday) return { tone: "none", pct: 0, text: "Χθες την ίδια ώρα δεν είχε πωλήσεις" };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  const ref = `χθες την ίδια ώρα (${euro(yesterday)})`;
  if (Math.abs(pct) < 3) return { tone: "same", pct, text: `Περίπου όσο ${ref}` };
  return pct > 0 ? { tone: "up", pct, text: `πάνω από ${ref}` } : { tone: "down", pct: -pct, text: `κάτω από ${ref}` };
}

/**
 * Πού βρίσκεται ο μηνιαίος στόχος απέναντι στον ρυθμό που χρειάζεται. Η σημερινή, μισή μέρα δεν μετρά εναντίον:
 * το «αναμενόμενο» είναι όσα έπρεπε να έχουν γίνει μέχρι χθες το βράδυ. Κάτω από 3% υστέρηση δεν είναι «πίσω».
 */
export function targetPace(soldCents: number, targetCents: number, dayOfMonth: number, daysInMonth: number) {
  const expected = (targetCents * (dayOfMonth - 1)) / daysInMonth;
  return {
    pct: Math.round((soldCents / targetCents) * 100),
    expectedPct: Math.round(((dayOfMonth - 1) / daysInMonth) * 100),
    gapCents: Math.round(expected - soldCents),
    perDayCents: Math.max(0, Math.ceil((targetCents - soldCents) / (daysInMonth - dayOfMonth + 1))),
    tone: soldCents >= targetCents ? "done" : soldCents >= expected * 0.97 ? "ok" : "behind",
  } as const;
}
