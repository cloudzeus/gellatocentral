import type { AccessAction } from "./access";
import { actorNameOf, getUser } from "./auth";
import { db } from "./db";

/** Γράφει μια γραμμή στο ιστορικό πρόσβασης. Αν αποτύχει, η ενέργεια του χρήστη δεν ακυρώνεται. */
export const logAccess = async (e: { orgId: string | null; actorName: string; action: AccessAction; target: string; detail?: string }) => {
  // Είσοδος υποστήριξης: η γραμμή γράφει και ποιος υπάλληλος ενεργούσε ως ο χρήστης. Εκτός αιτήματος (cron) δεν υπάρχει συνεδρία.
  const user = await getUser().catch(() => null);
  const actorName = user?.impersonator && e.actorName === user.name ? actorNameOf(user) : e.actorName;
  return db.accessEvent.create({ data: { ...e, actorName: actorName.slice(0, 200), target: e.target.slice(0, 200), detail: e.detail?.slice(0, 500) } }).catch(() => null);
};
