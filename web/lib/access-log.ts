import type { AccessAction } from "./access";
import { db } from "./db";

/** Γράφει μια γραμμή στο ιστορικό πρόσβασης. Αν αποτύχει, η ενέργεια του χρήστη δεν ακυρώνεται. */
export const logAccess = (e: { orgId: string | null; actorName: string; action: AccessAction; target: string; detail?: string }) =>
  db.accessEvent.create({ data: { ...e, target: e.target.slice(0, 200), detail: e.detail?.slice(0, 500) } }).catch(() => null);
