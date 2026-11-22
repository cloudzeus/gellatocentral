// Serializable posting με bounded retry ΟΛΟΚΛΗΡΗΣ της transaction μετά από serialization/deadlock conflict.
import { db } from "./db.ts";
import { Prisma } from "./generated/prisma/client.ts";

function retryableTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const code = "code" in current ? String(current.code) : "";
    if (code === "P2034" || code === "40001" || code === "40P01") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function stockTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt === 2 || !retryableTransactionError(error)) throw error;
    }
  }
  throw new Error("unreachable");
}
