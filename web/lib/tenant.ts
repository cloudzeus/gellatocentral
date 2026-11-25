import { cookies } from "next/headers";
import { cache } from "react";
import { currentOrg } from "./auth";
import { db } from "./db";
import { issuerOf } from "./documents/issuer";

export const POS_DEVICE_COOKIE = "pos_device";

/**
 * Το ταμείο (browser) στο οποίο δουλεύει ο χρήστης: αυτό που διάλεξε σε αυτόν τον browser, αλλιώς το πρώτο ενεργό
 * των καταστημάτων του. Πολλά ταμεία ανά κατάστημα, το καθένα με δικό του τερματικό Viva, σειρά και ΑΑ.
 */
export const currentContext = cache(async () => {
  const { user, role, org, storeIds } = await currentOrg("pos.use");
  const chosen = (await cookies()).get(POS_DEVICE_COOKIE)?.value;
  const devices = await db.device.findMany({
    where: { orgId: org.id, active: true, kind: "POS_WEB", series: { not: null }, store: { active: true, pauses: { none: { endedAt: null } } }, ...(storeIds.length ? { storeId: { in: storeIds } } : {}) }, // όχι ταμείο καταστήματος σε εποχιακή παύση
    orderBy: { createdAt: "asc" },
    include: { store: { include: { legalEntity: true } } },
  });
  const device = devices.find((d) => d.id === chosen) ?? devices[0];
  if (!device) throw new Error("Δεν υπάρχει ενεργό ταμείο browser για το κατάστημά σου. Ζήτησέ το από τον υπεύθυνο.");
  return { user, role, org, issuer: issuerOf(org, device.store.legalEntity), store: device.store, device: { ...device, series: device.series! }, tills: devices.map((d) => ({ id: d.id, name: d.name, store: d.store.name })) }; // το ερώτημα πιο πάνω εγγυάται σειρά
});
