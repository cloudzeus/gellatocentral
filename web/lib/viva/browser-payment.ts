import type { Prisma } from "@/lib/generated/prisma/client";
import {
  verifySaleSession,
  type VivaSaleForVerification,
  type VivaSaleVerification,
  type VivaTerminalForVerification,
} from "./cloud-terminal.ts";

export type BrowserPaymentSale = VivaSaleForVerification & {
  status: "AWAITING_PAYMENT" | "COMPLETED";
};

export type BrowserPaymentSyncResult =
  | { status: "completed" }
  | { status: "pending" }
  | { status: "failed" }
  | { status: "rejected"; reason: Extract<VivaSaleVerification, { status: "rejected" }>["reason"] }
  | { status: "error"; error: "viva_unavailable" };

type Mutations = {
  complete: (raw: Prisma.InputJsonObject, transactionId: string | undefined) => Promise<void>;
  fail: (reason: string, raw: Prisma.InputJsonObject) => Promise<void>;
};

type SessionLoader = (sessionId: string) => Promise<Record<string, unknown> | null>;

export type BrowserPaymentCancelResult =
  | { status: "cancelled" }
  | { status: "completed" }
  | { status: "aborting" }
  | BrowserPaymentSyncResult;

/**
 * «Ακύρωση» από τον ταμία: πρώτα Abort στη Viva, μετά η πώληση αποδεσμεύεται μόνο αν βεβαιωθεί ότι δεν χρεώθηκε.
 * Αν ο πελάτης πρόλαβε να πληρώσει, η πώληση ολοκληρώνεται. Αν η Viva δεν έχει κλείσει ακόμα τη συνεδρία, μένει σε
 * αναμονή και το επόμενο sync τη γυρίζει σε πρόχειρο όταν η Viva τη δηλώσει αποτυχημένη.
 */
export async function cancelBrowserPayment(
  sale: BrowserPaymentSale & { status: "AWAITING_PAYMENT" },
  terminal: VivaTerminalForVerification,
  mutations: Mutations,
  abort: (sessionId: string, cashRegisterId: string) => Promise<"accepted" | "not_found">,
  loadSession?: SessionLoader,
): Promise<BrowserPaymentCancelResult> {
  const sessionId = sale.payment?.vivaSessionId;
  // δοκιμαστική λειτουργία: δεν έφυγε τίποτα προς τη Viva
  if (!sessionId) {
    await mutations.fail("Ακυρώθηκε από τον ταμία", {});
    return { status: "cancelled" };
  }
  let aborted: "accepted" | "not_found";
  try {
    aborted = await abort(sessionId, terminal.deviceId);
  } catch {
    return { status: "error", error: "viva_unavailable" };
  }
  if (aborted === "not_found") {
    await mutations.fail("Ακυρώθηκε από τον ταμία (η Viva δεν είχε λάβει τη χρέωση)", { abort: "not_found" });
    return { status: "cancelled" };
  }
  const synced = await syncBrowserPayment(sale, terminal, mutations, loadSession);
  if (synced.status === "failed") return { status: "cancelled" };
  if (synced.status === "pending") return { status: "aborting" };
  return synced;
}

/** Κοινή απόδειξη Viva για το browser· μόνο η τελική, δεμένη αποτυχία γυρίζει την πώληση σε πρόχειρο. */
export async function syncBrowserPayment(
  sale: BrowserPaymentSale,
  terminal: VivaTerminalForVerification,
  mutations: Mutations,
  loadSession?: SessionLoader,
): Promise<BrowserPaymentSyncResult> {
  let verification: VivaSaleVerification;
  try {
    verification = await verifySaleSession(sale, terminal, undefined, loadSession);
  } catch {
    // Το δίκτυο/provider δεν αποφασίζει αποτυχία πληρωμής· η πώληση μένει για επόμενο sync.
    return { status: "error", error: "viva_unavailable" };
  }

  if (verification.status === "pending") return { status: "pending" };
  if (verification.status === "verified") {
    await mutations.complete(verification.raw as Prisma.InputJsonObject, verification.transactionId);
    return { status: "completed" };
  }

  // Μismatch ή ασαφής απάντηση δεν αλλάζει κατάσταση, ούτε κατά το replay ολοκληρωμένης πώλησης.
  if (verification.reason !== "unsuccessful" || verification.raw.success !== false || sale.status !== "AWAITING_PAYMENT")
    return { status: "rejected", reason: verification.reason };

  await mutations.fail(
    `Η πληρωμή δεν ολοκληρώθηκε (eventId ${String(verification.raw.eventId)})`,
    verification.raw as Prisma.InputJsonObject,
  );
  return { status: "failed" };
}
