// Ποιος εκδίδει ένα παραστατικό: το κατάστημα με δικό του ΑΦΜ (LegalEntity) ή, χωρίς αυτό, η ίδια η επιχείρηση.
// Από εδώ παίρνουν ΑΦΜ εκδότη, έμπορο Viva και κλειδιά myDATA το ταμείο, τα πιστωτικά και η χονδρική.

type OrgIssuer = { vatNumber: string; name: string; legalName?: string | null; taxOffice?: string | null; address?: string | null; city?: string | null; postalCode?: string | null; vivaMerchantId?: string | null; aadeUserId?: string | null; aadeSubKey?: string | null };
type EntityIssuer = { id: string; vatNumber: string; name: string; taxOffice: string | null; address: string | null; city: string | null; postalCode: string | null; vivaMerchantId: string | null; aadeUserId: string | null; aadeSubKey: string | null; active: boolean };

export type Issuer = {
  legalEntityId: string | null;
  vatNumber: string;
  name: string;
  taxOffice: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  vivaMerchantId: string | null;
  aadeUserId: string | null;
  aadeSubKey: string | null;
};

export class IssuerError extends Error {}

/** Pure: τα στοιχεία εκδότη ενός καταστήματος. Ανενεργός εκδότης σταματά την έκδοση αντί να γυρίσει σιωπηλά στην επιχείρηση. */
export function issuerOf(org: OrgIssuer, entity: EntityIssuer | null | undefined): Issuer {
  if (entity) {
    if (!entity.active) throw new IssuerError(`Ο εκδότης ${entity.name} (ΑΦΜ ${entity.vatNumber}) είναι ανενεργός`);
    return { legalEntityId: entity.id, vatNumber: entity.vatNumber, name: entity.name, taxOffice: entity.taxOffice, address: entity.address, city: entity.city, postalCode: entity.postalCode, vivaMerchantId: entity.vivaMerchantId, aadeUserId: entity.aadeUserId, aadeSubKey: entity.aadeSubKey };
  }
  return { legalEntityId: null, vatNumber: org.vatNumber, name: org.legalName || org.name, taxOffice: org.taxOffice ?? null, address: org.address ?? null, city: org.city ?? null, postalCode: org.postalCode ?? null, vivaMerchantId: org.vivaMerchantId ?? null, aadeUserId: org.aadeUserId ?? null, aadeSubKey: org.aadeSubKey ?? null };
}

/** Ο εκδότης του καταστήματος (storeId κενό = η επιχείρηση). */
export async function issuerForStore(orgId: string, storeId: string | null): Promise<Issuer & { storeAddress: { street: string; city: string; postalCode: string } | null }> {
  const { db } = await import("../db.ts"); // lazy: το issuerOf ελέγχεται χωρίς βάση
  const [org, store] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    storeId ? db.store.findFirst({ where: { id: storeId, orgId }, include: { legalEntity: true, geoCity: { select: { name: true } } } }) : null,
  ]);
  if (store?.legalEntity && store.legalEntity.orgId !== orgId) throw new IssuerError("Ο εκδότης του καταστήματος ανήκει σε άλλη επιχείρηση");
  const issuer = issuerOf(org, store?.legalEntity);
  // κατάστημα με δικό του χρήστη myDATA: τα κλειδιά του αντί του εκδότη, πάντα ως ζεύγος
  if (store?.aadeUserId && store.aadeSubKey) Object.assign(issuer, { aadeUserId: store.aadeUserId, aadeSubKey: store.aadeSubKey });
  return { ...issuer, storeAddress: store ? { street: store.address ?? "", city: store.city || store.geoCity?.name || "", postalCode: store.postalCode ?? "" } : null };
}
