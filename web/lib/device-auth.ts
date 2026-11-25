import { issuerOf } from "./documents/issuer";
import { createHash } from "node:crypto";
import { db } from "./db";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Η διεύθυνση από την οποία ήρθε το αίτημα. Το Next δεν δίνει τη διεύθυνση της σύνδεσης, μόνο το
 * x-forwarded-for· αυτό είναι αξιόπιστο ΜΟΝΟ όταν ο server δέχεται κίνηση αποκλειστικά μέσα από proxy που
 * το γράφει ο ίδιος (π.χ. `tailscale serve`). Γι' αυτό ο έλεγχος ενεργοποιείται ρητά με TRUST_PROXY=1.
 */
export function sourceIp(req: Request): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}
/** Αν η συσκευή έχει δηλωμένη διεύθυνση Tailscale, το αίτημα πρέπει να έρχεται από αυτήν. */
export const ipAllowed = (device: { tailscaleIp: string | null }, req: Request) => !device.tailscaleIp || sourceIp(req) === device.tailscaleIp;

/** Κάθε συζευγμένη συσκευή στέλνει `Authorization: Bearer <κλειδί συσκευής>`. null = άκυρο, ανενεργό ή λάθος δίκτυο. */
export async function deviceFromRequest(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (.{20,})$/)?.[1];
  if (!token) return null;
  const device = await db.device.findFirst({
    where: { apiTokenHash: hashToken(token), active: true, store: { active: true } },
    include: { store: { include: { org: true, legalEntity: true } } },
  });
  if (!device || !ipAllowed(device, req)) return null;
  // «τελευταία επαφή» για την κονσόλα· όχι σε κάθε αίτημα, για να μη γράφουμε συνέχεια
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000)
    await db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  // ο εκδότης των αποδείξεων: το κατάστημα με δικό του ΑΦΜ ή η επιχείρηση
  return { org: device.store.org, store: device.store, device, issuer: issuerOf(device.store.org, device.store.legalEntity) };
}

/** Μόνο ταμείο Android με σειρά αποδείξεων: οι υπόλοιπες συσκευές δεν εκδίδουν αποδείξεις. */
export async function tillFromRequest(req: Request) {
  const ctx = await deviceFromRequest(req);
  if (!ctx || ctx.device.kind !== "POS_ANDROID" || !ctx.device.series) return null;
  return { ...ctx, device: { ...ctx.device, series: ctx.device.series } };
}
