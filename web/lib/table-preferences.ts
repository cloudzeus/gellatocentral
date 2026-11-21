import { z } from "zod";

const key = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);

/** Μόνο διάταξη UI· δεν δέχεται ερωτήματα, tenant ids ή επιχειρησιακά δεδομένα. */
export const tablePreferencesSchema = z.object({
  widths: z.record(key, z.number().finite().min(72).max(1600)),
  hidden: z.array(key).max(100),
  order: z.array(key).max(100).default([]),
  pinned: z.array(key).max(100).default([]),
}).strict();

export type TablePreferences = z.infer<typeof tablePreferencesSchema>;
export const emptyTablePreferences: TablePreferences = { widths: {}, hidden: [], order: [], pinned: [] };
