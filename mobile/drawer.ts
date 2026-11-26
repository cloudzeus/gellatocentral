// Μέτρηση συρταριού στο κλείσιμο βάρδιας: χαρτονομίσματα/κέρματα σε λεπτά, διαφορά από τα αναμενόμενα.

/** Αξίες σε λεπτά, όπως στο mockup (shifts-till-close.html). Τα «ψιλά» γράφονται ως ποσό. */
export const DENOMS = [5000, 2000, 1000, 500, 200, 100, 50] as const;

/** «12,40» ή «12.4» → 1240· κενό → 0· άκυρο → null. */
export function parseEuro(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (!s) return 0;
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function countedCents(counts: Record<number, string>, loose: string): number | null {
  let total = parseEuro(loose);
  if (total == null) return null;
  for (const d of DENOMS) {
    const raw = (counts[d] ?? "").trim();
    if (!raw) continue;
    if (!/^\d{1,5}$/.test(raw)) return null;
    total += Number(raw) * d;
  }
  return total;
}

export type Tone = "ok" | "wait" | "bad";
/** Πράσινο όταν συμφωνεί, κίτρινο μέχρι το όριο (5 €), κόκκινο πάνω από αυτό. */
export const diffTone = (diffCents: number, limitCents = 500): Tone => (diffCents === 0 ? "ok" : Math.abs(diffCents) <= limitCents ? "wait" : "bad");

/** Διάρκεια βάρδιας «6 ώ 6′». */
export function duration(fromIso: string, to: Date): string {
  const m = Math.max(0, Math.floor((to.getTime() - new Date(fromIso).getTime()) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} ώ ${m % 60}′` : `${m}′`;
}

/** Αρχικά ονόματος για το avatar: «Μαρία Κ.» → «ΜΚ». */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toLocaleUpperCase("el")).join("");
