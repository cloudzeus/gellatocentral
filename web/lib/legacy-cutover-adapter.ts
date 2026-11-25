// Σύνδεσμος με το παλιό σύστημα· χωρίς πραγματική υλοποίηση κάθε cutover ενέργεια αποτυγχάνει.
import { z } from "zod";

export type LegacyCutoverRequest = { orgId: string; source: string; cursor: string };
export type LegacyAdapterOperation = "FREEZE" | "READ_ONLY" | "RESUME_WRITES";
export type LegacyCutoverEvidence = {
  operation: LegacyAdapterOperation;
  evidenceId: string;
  cursor: string;
  observedAt: string;
  details?: Record<string, unknown>;
};

export interface LegacyCutoverAdapter {
  freeze(request: LegacyCutoverRequest): Promise<LegacyCutoverEvidence>;
  setReadOnly(request: LegacyCutoverRequest): Promise<LegacyCutoverEvidence>;
  resumeWrites(request: LegacyCutoverRequest): Promise<LegacyCutoverEvidence>;
}

const unsupported = () => {
  throw new Error("Δεν έχει ρυθμιστεί legacy cutover adapter· δεν εκτελέστηκε καμία ενέργεια στο παλιό σύστημα");
};

/** Ασφαλής προεπιλογή: δεν παράγει τεκμηρίωση και δεν υπόσχεται εξωτερική αλλαγή. */
export class UnsupportedLegacyCutoverAdapter implements LegacyCutoverAdapter {
  async freeze(): Promise<LegacyCutoverEvidence> { return unsupported(); }
  async setReadOnly(): Promise<LegacyCutoverEvidence> { return unsupported(); }
  async resumeWrites(): Promise<LegacyCutoverEvidence> { return unsupported(); }
}

export const defaultLegacyCutoverAdapter = new UnsupportedLegacyCutoverAdapter();

const evidenceSchema = z.object({
  operation: z.enum(["FREEZE", "READ_ONLY", "RESUME_WRITES"]),
  evidenceId: z.string().trim().min(1).max(160),
  cursor: z.string().trim().min(1).max(200),
  observedAt: z.string().datetime({ offset: true }),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** Το evidence του adapter ελέγχεται ξανά στο server και δένει με τον τρέχοντα cursor. */
export function verifiedLegacyEvidence(value: unknown, operation: LegacyAdapterOperation, cursor: string): LegacyCutoverEvidence {
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success || parsed.data.operation !== operation || parsed.data.cursor !== cursor || Number.isNaN(Date.parse(parsed.data.observedAt))) {
    throw new Error("Το legacy adapter evidence είναι άκυρο ή δεν αντιστοιχεί στον τρέχοντα cursor");
  }
  return parsed.data;
}
