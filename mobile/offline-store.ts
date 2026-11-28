// Ό,τι πρέπει να επιζήσει κλείσιμο της εφαρμογής χωρίς σύνδεση: ο τελευταίος κατάλογος και η ουρά πωλήσεων.
// Αρχεία και όχι SecureStore: ο κατάλογος ξεπερνά το όριο μεγέθους του· δεν έχουν μυστικά.
import { File, Paths } from "expo-file-system";
import type { Catalog } from "./api";
import type { Outbox } from "./offline";

async function read<T>(name: string, fallback: T): Promise<T> {
  const f = new File(Paths.document, name);
  if (!f.exists) return fallback;
  try { return JSON.parse(await f.text()) as T; } catch { return fallback; }
}
async function write(name: string, value: unknown) {
  const f = new File(Paths.document, name);
  if (!f.exists) f.create();
  await f.write(JSON.stringify(value));
}

export const loadCachedCatalog = () => read<Catalog | null>("catalog.json", null);
export const saveCachedCatalog = (c: Catalog) => write("catalog.json", c);
export const loadOutbox = () => read<Outbox>("outbox.json", { lastAa: 0, sales: [] });
export const saveOutbox = (o: Outbox) => write("outbox.json", o);
/** Η σάρωση παραλαβής σε εξέλιξη: αν κοπεί το σήμα ή κλείσει η εφαρμογή στην αποθήκη, δεν χάνεται. */
export const loadReceivingDraft = <T>() => read<T | null>("receiving.json", null);
export const saveReceivingDraft = (d: unknown) => write("receiving.json", d);
