// JSON domain errors για τα offline count routes· δεν εκτίθενται εσωτερικά stack traces.
import { STOCK_COUNT_ERROR_MESSAGE, StockCountError } from "./stock-count-request.ts";
import { STOCK_ERROR_MESSAGE, StockError } from "./stock-db.ts";
import { STOCK_SCOPE_ERROR_MESSAGE, StockScopeError } from "./stock-scope.ts";

export function stockCountHttpError(error: unknown): Response {
  if (error instanceof StockCountError) {
    const status = error.code === "COUNT_NOT_FOUND" ? 404 : ["INVALID_COUNT_REQUEST", "INVALID_COUNT_LINE"].includes(error.code) ? 400 : 409;
    return Response.json({ code: error.code, message: STOCK_COUNT_ERROR_MESSAGE[error.code] }, { status });
  }
  if (error instanceof StockScopeError) {
    const status = error.code === "STORE_NOT_FOUND" || error.code === "WAREHOUSE_NOT_FOUND" ? 404 : 409;
    return Response.json({ code: error.code, message: STOCK_SCOPE_ERROR_MESSAGE[error.code] }, { status });
  }
  if (error instanceof StockError) {
    const status = error.code === "INVALID_STOCK_INPUT" || error.code === "INVALID_STOCK_QUANTITY" ? 400 : 409;
    return Response.json({ code: error.code, message: STOCK_ERROR_MESSAGE[error.code] }, { status });
  }
  return Response.json({ code: "INTERNAL_ERROR", message: "Η συγχρονισμένη ενέργεια δεν ολοκληρώθηκε· δοκίμασε ξανά" }, { status: 500 });
}
