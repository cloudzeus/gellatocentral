import { cache } from "react";
import { currentOrg } from "./auth";
import { db } from "./db";

/** Το ταμείο (browser) στο οποίο δουλεύει ο χρήστης: το πρώτο ενεργό του καταστήματός του. */
export const currentContext = cache(async () => {
  const { user, role, org, storeId } = await currentOrg("pos.use");
  // shortcut: ένα ταμείο browser ανά χρήστη/κατάστημα· επιλογή ταμείου όταν ένα κατάστημα αποκτήσει δεύτερο
  const device = await db.device.findFirst({
    where: { orgId: org.id, active: true, kind: "POS_WEB", series: { not: null }, store: { active: true }, ...(storeId ? { storeId } : {}) },
    orderBy: { createdAt: "asc" },
    include: { store: true },
  });
  if (!device) throw new Error("Δεν υπάρχει ενεργό ταμείο browser για το κατάστημά σου. Ζήτησέ το από τον υπεύθυνο.");
  return { user, role, org, store: device.store, device: { ...device, series: device.series! } }; // το ερώτημα πιο πάνω εγγυάται σειρά
});
