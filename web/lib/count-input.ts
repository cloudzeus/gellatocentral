// Πεδία απογραφής σε μονάδα εμφάνισης (kg / l / τεμ) αντί για βασική (mg / ml): ο χρήστης ζυγίζει «1,80»,
// η βάση κρατά 1.800.000 mg. Καθαρό module, το χρησιμοποιούν και η server action και η offline φόρμα.

/** Επιτρεπτές κλίμακες: 1 (τεμ, ml, mg), 1.000 (l, g), 1.000.000 (kg). */
export const COUNT_INPUT_SCALES = [1, 1_000, 1_000_000] as const;

/** «1,80» × 1.000.000 → 1.800.000· κενό → null· άκυρο, αρνητικό ή κλίμακα εκτός λίστας → NaN. */
export function countInputToBase(raw: string, scale: number): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  if (!(COUNT_INPUT_SCALES as readonly number[]).includes(scale) || !/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  return Math.round(Number(text) * scale);
}

/** 1.800.000 / 1.000.000 → «1,8» (χωρίς μονάδα, για την τιμή του πεδίου). */
export const baseToCountInput = (base: number | null, scale: number) => base === null ? "" : String(base / scale).replace(".", ",");
