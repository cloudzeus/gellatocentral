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
  complete: (raw: Prisma.InputJsonObject, transactionId: string) => Promise<void>;
  fail: (reason: string, raw: Prisma.InputJsonObject) => Promise<void>;
};

type SessionLoader = (sessionId: string) => Promise<Record<string, unknown> | null>;

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
