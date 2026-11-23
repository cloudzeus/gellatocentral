// Κοινό σημείο δημιουργίας των ιστορικών αντιγράφων για χειροκίνητα, OCR και myDATA παραστατικά.
import { db } from "./db";
import { partySnapshot, type PartySnapshotInput } from "./purchase-document";

export async function purchaseSnapshots(org: { id: string; name: string; vatNumber: string }, supplier: PartySnapshotInput) {
  const buyer = await db.party.findFirst({ where: { linkedOrgId: org.id } });
  return {
    supplierSnapshot: partySnapshot(supplier),
    buyerSnapshot: partySnapshot({ ...buyer, name: org.name, vatNumber: org.vatNumber, countryCode: buyer?.countryCode ?? "GR" }),
  };
}
