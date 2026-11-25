// Ξεχωριστό endpoint από το PDF: GET δίνει μόνο masked, συσχετισμένους παραλήπτες· POST απαιτεί edit RBAC και confirmation.
import type { Permission } from "../permissions";
import { deliverDocument, DocumentDeliveryError, isDeliveryChannel, listDocumentRecipients } from "../document-delivery";
import { StockScopeError, type StockContext, type StockScopeInput } from "../stock-scope";
import { stockApiContext } from "../stock-context";
import { DOCUMENT_CONFIG, isDocumentEntity, type DocumentEntity, type LoadedDocument } from "./model";
import { loadDocument } from "./load";

type AuthResult = { ctx: StockContext } | { error: Response };
export type DocumentDeliveryRouteDeps = {
  authorize: (permission: Permission, scope?: StockScopeInput) => Promise<AuthResult>;
  load: (ctx: StockContext, entityType: DocumentEntity, entityId: string) => Promise<LoadedDocument | null>;
  list: typeof listDocumentRecipients;
  deliver: typeof deliverDocument;
};
const productionDeps: DocumentDeliveryRouteDeps = { authorize: stockApiContext, load: loadDocument, list: listDocumentRecipients, deliver: deliverDocument };
const jsonError = (status: number, code: string, message: string) => Response.json({ code, message }, { status, headers: { "Cache-Control": "private, no-store" } });

async function input(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DocumentDeliveryError("INVALID_JSON", "Απαιτείται JSON αίτημα");
  const raw = await request.text();
  if (raw.length > 4096) throw new DocumentDeliveryError("INVALID_JSON", "Το αίτημα αποστολής είναι υπερβολικά μεγάλο");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new DocumentDeliveryError("INVALID_JSON", "Μη έγκυρο JSON αίτημα"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DocumentDeliveryError("INVALID_JSON", "Μη έγκυρο αίτημα αποστολής");
  const value = body as Record<string, unknown>;
  if (!isDeliveryChannel(value.channel) || typeof value.recipientId !== "string" || typeof value.confirm !== "boolean") throw new DocumentDeliveryError("INVALID_INPUT", "Έλεγξε κανάλι, παραλήπτη και επιβεβαίωση");
  return { channel: value.channel, recipientId: value.recipientId, confirm: value.confirm };
}

export async function handleDocumentDeliveryRequest(request: Request, entityType: string, entityId: string, deps: DocumentDeliveryRouteDeps = productionDeps) {
  if (!isDocumentEntity(entityType)) return jsonError(404, "NOT_FOUND", "Το έγγραφο δεν βρέθηκε");
  const config = DOCUMENT_CONFIG[entityType];
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return jsonError(405, "METHOD_NOT_ALLOWED", "Μη υποστηριζόμενη μέθοδος");
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) return jsonError(403, "BAD_ORIGIN", "Μη αποδεκτή προέλευση");
  }
  try {
    const auth = await deps.authorize(config.permission);
    if ("error" in auth) return auth.error;
    const loaded = await deps.load(auth.ctx, entityType, entityId);
    if (!loaded) return jsonError(404, "NOT_FOUND", "Το έγγραφο δεν βρέθηκε");
    if (loaded.scope) {
      const scoped = await deps.authorize(config.permission, loaded.scope);
      if ("error" in scoped) return scoped.error;
    }
    if (method === "GET") {
      const result = await deps.list(auth.ctx, loaded);
      return Response.json({ ...result, canSend: auth.ctx.can(config.sendPermission) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Η ανάγνωση εγγράφου δεν αρκεί για εξωτερική κοινοποίηση. Το scope επαναελέγχεται και στο write permission.
    const writeAuth = await deps.authorize(config.sendPermission, loaded.scope);
    if ("error" in writeAuth) return writeAuth.error;
    const delivery = await deps.deliver(writeAuth.ctx, loaded, await input(request));
    return Response.json({ delivery }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DocumentDeliveryError) return jsonError(error.status, error.code, error.message);
    if (error instanceof StockScopeError) return jsonError(403, "FORBIDDEN", "Δεν έχεις πρόσβαση σε αυτό το έγγραφο");
    // Δεν τυπώνεται error object: μπορεί να περιέχει provider body ή configuration.
    console.error("document delivery route", { entityType, entityId, method });
    return jsonError(500, "DELIVERY_FAILED", "Η ενέργεια αποστολής απέτυχε χωρίς επιβεβαίωση provider");
  }
}
