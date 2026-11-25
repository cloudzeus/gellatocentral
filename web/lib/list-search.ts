import { db } from "@/lib/db";

/**
 * Αναζήτηση λίστας με όνομα συναλλασσομένου όταν το μοντέλο κρατά μόνο το id του (χωρίς σχέση στο schema):
 * τα ids όσων ταιριάζουν, για `{ customerId: { in } }`. Πάντα μέσα στην επιχείρηση.
 */
export async function partyIdsByName(orgId: string, q: string): Promise<string[]> {
  if (!q) return [];
  // shortcut: ως 200 συναλλασσόμενοι ανά αναζήτηση· αν μια επιχείρηση έχει περισσότερους ομώνυμους, να γίνει σχέση στο schema
  const rows = await db.party.findMany({ where: { orgId, name: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 200 });
  return rows.map((row) => row.id);
}
