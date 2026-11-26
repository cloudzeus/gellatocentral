// Κοινά κομμάτια των API της εφαρμογής ταμείου (άμεση πώληση και πληρωμή λογαριασμού).
import { BillError } from "./bills";
import { db } from "./db";
import { TenantWriteBlockedError } from "./migration-cutover";
import { failSale, pendingSale, PosError } from "./pos";
import { ModifierError } from "./pos-modifiers";
import { accessFor } from "./plan-data";
import { startSale, vivaConfigured, VivaUnknownOutcomeError } from "./viva/cloud-terminal";
import { toVivaJson } from "./viva/fiscal";

/** Αναστολή, κλείσιμο, απλήρωτη συνδρομή, εποχιακή παύση ή πακέτο χωρίς ταμείο: δεν γίνονται νέες πωλήσεις ή παραγγελίες. */
export async function pausedResponse(ctx: { org: { id: string }; device: { storeId: string } }) {
  const access = await accessFor(ctx.org.id, [ctx.device.storeId]);
  if (access.open.includes("pos")) return null;
  const message = access.state.kind === "closing" ? "Η επιχείρηση κλείνει: το ταμείο είναι κλειστό"
    : access.state.kind === "suspended" ? "Η επιχείρηση είναι σε αναστολή. Επικοινώνησε με την υποστήριξη"
    : access.state.kind === "unpaid" ? "Η συνδρομή έχει λήξει. Με την πληρωμή το ταμείο ανοίγει αμέσως"
    : access.paused ? "Το κατάστημα είναι σε εποχιακή παύση. Ο διαχειριστής το ανοίγει ξανά από τη Συνδρομή"
    : "Το πακέτο της επιχείρησης δεν περιλαμβάνει ταμείο";
  return Response.json({ error: "paused", message }, { status: 403 });
}

/** Ό,τι χρειάζεται η εφαρμογή για να ανοίξει το Viva Terminal (deeplink inter-app). */
export const startPayload = (s: { saleId: string; reference: string; receipt: { totalCents: number; data: unknown }; chargeCents?: number }) => ({
  saleId: s.saleId,
  reference: s.reference,
  amountCents: s.chargeCents ?? s.receipt.totalCents, // στο μοίρασμα κατά ποσό το τερματικό χρεώνει μόνο το υπόλοιπο
  // Για το deeplink της Viva (inter-app): το fiscalisationData πηγαίνει Base64URL
  fiscalisationData: Buffer.from(toVivaJson(s.receipt.data)).toString("base64url"),
});

type Till = Parameters<typeof pendingSale>[1];

/** Γνωστές αποτυχίες → απάντηση με κωδικό για τη συσκευή. Ό,τι άλλο → 500 (καταγράφεται). */
export async function tillErrorResponse(e: unknown, ctx: Till, where: string) {
  // 409 ΜΟΝΟ όταν υπάρχει ήδη πληρωμή σε εξέλιξη: η εφαρμογή το διαβάζει έτσι. Μαζί πάει η εκκρεμής πώληση, ώστε η
  // συσκευή να τη συνεχίσει ακόμη κι αν έχασε την πρώτη απάντηση (κακό δίκτυο) ή έκλεισε στη μέση.
  if (e instanceof PosError && e.code === "busy") {
    const pending = await pendingSale(db, ctx);
    return Response.json({ error: "busy", message: e.message, pending: pending && { ...startPayload(pending), external: "vivaCloud" in ctx.device ? !!ctx.device.vivaCloud : false, methodId: pending.methodId, methodName: pending.methodName, issuedAt: pending.issuedAt } }, { status: 409 });
  }
  if (e instanceof PosError) return Response.json({ error: e.code, message: e.message }, { status: 400 });
  if (e instanceof BillError) return Response.json({ error: e.code, message: e.message }, { status: e.code === "not_found" ? 404 : 409 });
  if (e instanceof ModifierError) return Response.json({ error: "invalid_options", message: e.message }, { status: 400 });
  if (e instanceof TenantWriteBlockedError) return Response.json({ error: "paused", message: e.message }, { status: 403 });
  console.error(`${where}:`, e instanceof Error ? e.message : e);
  return Response.json({ error: "internal" }, { status: 500 });
}

/**
 * Ταμείο Android με τερματικό σε ΑΛΛΗ συσκευή (Device.vivaCloud, π.χ. SoftPOS σε τηλέφωνο): ο server στέλνει τη χρέωση
 * στο τερματικό (Cloud Terminal), όπως το ταμείο του browser, και η εφαρμογή περιμένει ρωτώντας το /result.
 * null = στάλθηκε ή άγνωστο αποτέλεσμα (η πώληση μένει «περιμένει πληρωμή» και τη λύνει η Viva)· αλλιώς η απάντηση λάθους.
 */
export async function sendToTerminal(
  ctx: { org: { id: string }; device: { id: string; vivaTerminalId: string | null }; issuer: { vivaMerchantId: string | null } },
  started: { saleId: string; reference: string; receipt: { totalCents: number; data: unknown }; chargeCents?: number },
  /** Τι ακυρώνεται όταν η Viva αρνηθεί: η πώληση (προεπιλογή) ή το μερίδιο του μοιράσματος. */
  undo: (message: string) => Promise<unknown> = (message) => failSale(ctx.device.id, started.saleId, message, undefined, ctx.org.id),
) {
  if (!(await vivaConfigured())) return null; // δοκιμαστική λειτουργία: τίποτα δεν φεύγει προς τη Viva
  const fail = async (message: string) => {
    await undo(message);
    return Response.json({ error: "terminal_unavailable", message }, { status: 400 });
  };
  if (!ctx.issuer.vivaMerchantId || !ctx.device.vivaTerminalId) return fail("Λείπει ο κωδικός εμπόρου Viva ή το τερματικό του ταμείου");
  try {
    await startSale({
      sessionId: started.reference,
      terminalId: ctx.device.vivaTerminalId,
      cashRegisterId: ctx.device.id,
      amountCents: started.chargeCents ?? started.receipt.totalCents,
      merchantReference: started.saleId,
      terminalMerchantId: ctx.issuer.vivaMerchantId,
      fiscalisationData: started.receipt.data,
    });
    return null;
  } catch (e) {
    // άγνωστο αποτέλεσμα: η χρέωση μπορεί να έφτασε· αν γύριζε σε πρόχειρο, νέα «Είσπραξη» θα χρέωνε δεύτερη φορά
    if (e instanceof VivaUnknownOutcomeError) return null;
    console.error("pos/sales → POS:", e instanceof Error ? e.message : e);
    return fail("Η χρέωση δεν έφτασε στο POS. Έλεγξε ότι το Viva.com Terminal είναι ανοιχτό και δοκίμασε ξανά");
  }
}
