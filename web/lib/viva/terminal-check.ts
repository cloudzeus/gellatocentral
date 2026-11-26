// Έλεγχος του Terminal ID ενός ταμείου πριν αποθηκευτεί: ένα τερματικό ανά ενεργό ταμείο, και να ανήκει
// στον έμπορο Viva του εκδότη του καταστήματος. Επιστρέφει το μήνυμα για τον χρήστη ή null αν όλα καλά.

type Other = { orgId: string; name: string; store: string };

export type TerminalCheckDeps = {
  /** Άλλο ενεργό ταμείο (σε οποιαδήποτε επιχείρηση) με το ίδιο τερματικό. */
  findOther: (terminalId: string, exceptDeviceId?: string) => Promise<Other | null>;
  issuer: (orgId: string, storeId: string) => Promise<{ name: string; vatNumber: string; vivaMerchantId: string | null }>;
  vivaConfigured: () => Promise<boolean>;
  merchantTerminals: (merchantId: string) => Promise<string[]>;
};

export async function terminalProblem(
  input: { terminalId: string | null | undefined; orgId: string; storeId: string; deviceId?: string },
  deps: TerminalCheckDeps,
): Promise<string | null> {
  const terminalId = input.terminalId?.trim();
  if (!terminalId) return null;

  const other = await deps.findOther(terminalId, input.deviceId);
  // σε άλλη επιχείρηση δεν λέμε ποια: είναι στοιχεία άλλου πελάτη
  if (other) return other.orgId === input.orgId
    ? `Το τερματικό ${terminalId} είναι ήδη στο ταμείο «${other.name}» (${other.store}). Κάθε ταμείο θέλει δικό του τερματικό`
    : `Το τερματικό ${terminalId} χρησιμοποιείται ήδη από άλλη επιχείρηση`;

  // χωρίς κλειδιά ISV ή χωρίς έμπορο τα ταμεία είναι σε δοκιμαστική λειτουργία: δεν υπάρχει κάτι να ρωτηθεί
  const issuer = await deps.issuer(input.orgId, input.storeId);
  if (!issuer.vivaMerchantId || !(await deps.vivaConfigured())) return null;
  let terminals: string[];
  try {
    terminals = await deps.merchantTerminals(issuer.vivaMerchantId);
  } catch {
    return "Δεν έγινε ο έλεγχος του τερματικού στη Viva. Δοκίμασε ξανά σε λίγο";
  }
  if (!terminals.includes(terminalId))
    return `Το τερματικό ${terminalId} δεν βρέθηκε στον έμπορο Viva του ${issuer.name} (ΑΦΜ ${issuer.vatNumber}). Έλεγξε τον αριθμό στην εφαρμογή Viva.com Terminal`;
  return null;
}

/** Οι πραγματικές εξαρτήσεις: βάση, εκδότης καταστήματος, devices:search της Viva. */
export async function liveTerminalDeps(): Promise<TerminalCheckDeps> {
  const [{ db }, { issuerForStore }, viva] = await Promise.all([import("../db.ts"), import("../documents/issuer.ts"), import("./cloud-terminal.ts")]);
  return {
    findOther: async (terminalId, exceptDeviceId) => {
      const d = await db.device.findFirst({
        where: { vivaTerminalId: terminalId, active: true, ...(exceptDeviceId ? { id: { not: exceptDeviceId } } : {}) },
        select: { orgId: true, name: true, store: { select: { name: true } } },
      });
      return d && { orgId: d.orgId, name: d.name, store: d.store.name };
    },
    issuer: issuerForStore,
    vivaConfigured: viva.vivaConfigured,
    merchantTerminals: async (merchantId) => (await viva.searchDevices({ merchantId })).map((t) => t.terminalId),
  };
}

export const checkTerminal = async (input: Parameters<typeof terminalProblem>[0]) => terminalProblem(input, await liveTerminalDeps());
