// Λεπτό, ελεγχόμενο route contract· τα tests εισάγουν doubles χωρίς βάση ή εξωτερικό storage.
import type { Permission } from "../permissions";
import { StockScopeError, type StockContext, type StockScopeInput } from "../stock-scope";
import { stockApiContext } from "../stock-context";
import { DOCUMENT_CONFIG, isDocumentEntity, type DocumentEntity, type LoadedDocument } from "./model";
import { loadDocument } from "./load";
import { generateAndStorePdf, scheduleExportFromSnapshot } from "./output";

type AuthResult = { ctx: StockContext } | { error: Response };
export type DocumentRouteDeps = {
  authorize: (permission: Permission, scope?: StockScopeInput) => Promise<AuthResult>;
  load: (ctx: StockContext, entityType: DocumentEntity, entityId: string) => Promise<LoadedDocument | null>;
  storePdf: typeof generateAndStorePdf;
  exportSchedule: typeof scheduleExportFromSnapshot;
};

const productionDeps: DocumentRouteDeps = { authorize: stockApiContext, load: loadDocument, storePdf: generateAndStorePdf, exportSchedule: scheduleExportFromSnapshot };
const jsonError = (status: number, code: string, message: string) => Response.json({ code, message }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function handleDocumentRequest(request: Request, entityType: string, entityId: string, deps: DocumentRouteDeps = productionDeps) {
  if (!isDocumentEntity(entityType)) return jsonError(404, "NOT_FOUND", "Το έγγραφο δεν βρέθηκε");
  const config = DOCUMENT_CONFIG[entityType];
  const method = request.method.toUpperCase();
  const requestedFormat = new URL(request.url).searchParams.get("format") ?? "pdf";
  if (!["pdf", "xlsx", "csv", "ics"].includes(requestedFormat)) return jsonError(400, "INVALID_FORMAT", "Μη υποστηριζόμενη μορφή");
  const format = requestedFormat as "pdf" | "xlsx" | "csv" | "ics";
  if (method === "POST" && format !== "pdf") return jsonError(400, "INVALID_FORMAT", "Μόνο PDF αποθηκεύεται μέσω αυτού του αιτήματος");
  if (method === "GET" && format === "pdf") return jsonError(405, "METHOD_NOT_ALLOWED", "Η δημιουργία PDF γίνεται με POST");
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) return jsonError(403, "BAD_ORIGIN", "Μη αποδεκτή προέλευση");
  }

  const auth = await deps.authorize(config.permission);
  if ("error" in auth) return auth.error;
  const loaded = await deps.load(auth.ctx, entityType, entityId);
  // Ξένο tenant και ανύπαρκτη οντότητα έχουν σκόπιμα την ίδια απάντηση.
  if (!loaded) return jsonError(404, "NOT_FOUND", "Το έγγραφο δεν βρέθηκε");
  if (loaded.scope) {
    try {
      const scoped = await deps.authorize(config.permission, loaded.scope);
      if ("error" in scoped) return scoped.error;
    } catch (error) {
      if (error instanceof StockScopeError) return jsonError(403, "FORBIDDEN", "Δεν έχεις πρόσβαση σε αυτό το έγγραφο");
      throw error;
    }
  }

  try {
    if (format === "pdf") {
      const file = await deps.storePdf(auth.ctx, loaded.model, loaded.scope);
      return Response.json({ document: { entityType, entityId, format }, file, delivery: { status: "STORED", externalSending: "NOT_SENT" } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (entityType !== "schedule_publication" || !loaded.schedule) return jsonError(400, "INVALID_FORMAT", "Η μορφή υποστηρίζεται μόνο για δημοσιευμένο πρόγραμμα");
    const exported = await deps.exportSchedule(loaded.model, loaded.schedule.snapshot, format, loaded.schedule.version, loaded.schedule.fromAt, loaded.schedule.toAt);
    return new Response(exported.data as BodyInit, { headers: { "Content-Type": exported.contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exported.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof StockScopeError) return jsonError(403, "FORBIDDEN", "Δεν έχεις πρόσβαση σε αυτό το έγγραφο");
    console.error("document output", { entityType, entityId, error });
    return jsonError(500, "OUTPUT_FAILED", "Η δημιουργία του εγγράφου απέτυχε");
  }
}
