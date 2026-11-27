// Κανόνες επανάληψης διαβιβάσεων, χωρίς βάση (τα χρησιμοποιούν το retryFiscal και το ημερολόγιο διαβιβάσεων).
/** Τύποι που υπογράφει ο server και άρα ξαναστέλνει η επανάληψη: 8.6 τραπεζιών και χονδρική. */
export const RETRIED_TYPES = ["8.6", "1.1", "2.1", "5.1", "9.3"] as const;
export const MAX_ATTEMPTS = 20;
export const STALE_PENDING_MS = 10 * 60_000; // διακοπή στη μέση της κλήσης: το PENDING ξαναπαίρνεται

/** Αναμονή πριν από την προσπάθεια n+1: 1, 2, 4 … λεπτά, έως 6 ώρες. */
export const backoffMs = (failures: number) => Math.min(2 ** Math.max(failures - 1, 0), 360) * 60_000;

/** Απόρριψη από ΑΑΔΕ/Viva (λάθος στοιχεία): η επανάληψη δεν τη διορθώνει, θέλει διόρθωση από άνθρωπο. Δίκτυο, 5xx, 429 → ξανά. */
export const needsCorrection = (error: string | null) => !!error && /ValidationError|HTTP 4(?!29)\d\d/.test(error);


/** Τα μηνύματα της ΑΑΔΕ μέσα από το JSON της Viva («LoadingAddress-> street … are mandatory»), αλλιώς το κείμενο όπως είναι. */
export function readableError(error: string | null) {
  if (!error) return null;
  const messages = [...error.matchAll(/\\*"message\\*"\s*:\s*\\*"(.+?)\\*"/g)].map((m) => m[1].trim()).filter((m) => !m.startsWith("FiskaltrustSignReceiptErrorState"));
  if (messages.length) return `Απόρριψη ΑΑΔΕ: ${messages.join(" · ")}`;
  // σφάλμα αιτήματος της Viva (HTTP 400): μόνο το πεδίο και ο λόγος, όχι όλο το αίτημα
  const fields = [...error.matchAll(/"loc":\[[^\]]*?"([^"]+)"\],"msg":"([^"]+)"/g)].map((m) => `${m[1]}: ${m[2]}`);
  if (fields.length) return `Η Viva απέρριψε το αίτημα (${fields.join(" · ")})`;
  return error.length > 300 ? `${error.slice(0, 300)}…` : error;
}
