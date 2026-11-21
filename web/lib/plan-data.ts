// Το πακέτο κάθε επιχείρησης, τα καταστήματά της και ποιες ενότητες είναι ανοιχτές αυτή τη στιγμή (πακέτο + εποχιακή παύση).
import { cache } from "react";
import { db } from "./db";
import { ALL_MODULES } from "./modules";
import { orgState, RESTRICTED_MODULES } from "./org-state";
import { chargeFor, type PlanPricing, type StoreInput } from "./plans";

const prices = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, n]) => [k, Math.max(0, Math.round(Number(n) || 0))]));
export type PlanRow = PlanPricing & { id: string; name: string; modules: string[]; pausedModules: string[]; pauseMaxDaysPerYear: number };
export const toPlanRow = (p: { id: string; name: string; modules: string[]; pausedModules: string[]; storeCents: number; devicePrices: unknown; pausePercent: number; pauseMaxDaysPerYear: number }): PlanRow => ({ ...p, devicePrices: prices(p.devicePrices) });
// χωρίς κανένα πακέτο στη βάση (δεν θα έπρεπε: το migration φτιάχνει το «Βασικό») όλα είναι ανοιχτά και δωρεάν
const NONE: PlanRow = { id: "", name: "Χωρίς πακέτο", modules: [...ALL_MODULES], pausedModules: [], storeCents: 0, devicePrices: {}, pausePercent: 100, pauseMaxDaysPerYear: 0 };

export const defaultPlan = cache(async () => { const p = (await db.plan.findFirst({ where: { isDefault: true } })) ?? (await db.plan.findFirst({ orderBy: { createdAt: "asc" } })); return p ? toPlanRow(p) : NONE; });
/** Το πακέτο της επιχείρησης· αν δεν έχει οριστεί, το προεπιλεγμένο. */
export const planOf = cache(async (orgId: string) => {
  const sub = await db.subscription.findUnique({ where: { orgId }, include: { plan: true } });
  return sub?.plan ? toPlanRow(sub.plan) : defaultPlan();
});

/** Τα ενεργά καταστήματα με τις ενεργές συσκευές και τις παύσεις τους, όπως τα θέλει ο υπολογισμός της χρέωσης. */
export const billableStores = cache(async (orgId: string) => {
  const stores = await db.store.findMany({ where: { orgId, active: true }, orderBy: { name: "asc" }, include: { devices: { where: { active: true }, select: { kind: true } }, pauses: { orderBy: { startedAt: "desc" } } } });
  return stores.map((s) => ({ id: s.id, name: s.name, deviceKinds: s.devices.map((d) => d.kind as string), pauses: s.pauses, paused: s.pauses.find((p) => !p.endedAt) ?? null })) satisfies (StoreInput & { paused: unknown })[];
});

/**
 * Ποιες ενότητες βλέπει ένας χρήστης: όσες έχει το πακέτο· αν τα καταστήματά του είναι σε παύση (ή, για χρήστη
 * όλων των καταστημάτων, αν είναι ΟΛΑ σε παύση), μόνο όσες το πακέτο κρατά ανοιχτές στην παύση.
 * storeIds: τα καταστήματα του μέλους· κενός πίνακας = όλα.
 */
export const accessFor = cache(async (orgId: string, storeIds: string[]) => {
  const [plan, stores, org] = await Promise.all([
    planOf(orgId),
    db.store.findMany({ where: { orgId, active: true }, select: { id: true, name: true, pauses: { where: { endedAt: null }, select: { startedAt: true }, take: 1 } } }),
    db.organization.findUnique({ where: { id: orgId }, select: { suspendedAt: true, suspendedReason: true, closingAt: true, deleteAfter: true, subscription: { select: { status: true, currentPeriodEnd: true } } } }),
  ]);
  const pausedStores = stores.filter((s) => s.pauses.length).map((s) => ({ id: s.id, name: s.name, since: s.pauses[0].startedAt }));
  const mine = storeIds.length ? stores.filter((s) => storeIds.includes(s.id)) : stores;
  const paused = mine.length > 0 && mine.every((s) => s.pauses.length);
  // αναστολή, κλείσιμο ή απλήρωτη συνδρομή: μένουν μόνο όσα χρειάζονται για να πληρώσει και να δει το αρχείο του
  const state = org ? orgState(org, new Date()) : ({ kind: "ok", restricted: false, daysLeft: null } as const);
  const byPlan = paused ? plan.modules.filter((m) => plan.pausedModules.includes(m)) : plan.modules;
  return { plan, paused, pausedStores, state, reason: org?.suspendedReason ?? null, open: state.restricted ? byPlan.filter((m) => (RESTRICTED_MODULES as readonly string[]).includes(m)) : byPlan };
});
export const storePaused = async (storeId: string) => !!(await db.storePause.findFirst({ where: { storeId, endedAt: null }, select: { id: true } }));

/** Η χρέωση του επόμενου μήνα όπως θα εκδοθεί τώρα: περίοδος, ανάλυση ανά κατάστημα και ποιες παύσεις τακτοποιεί. */
export async function nextCharge(orgId: string) {
  const [sub, plan, stores] = await Promise.all([db.subscription.findUnique({ where: { orgId } }), planOf(orgId), billableStores(orgId)]);
  if (!sub) return null;
  const now = new Date();
  const periodStart = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : new Date(now.toDateString());
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  // από πότε πληρώνει: η αρχή της πρώτης χρέωσης που έχει εκδοθεί, αλλιώς αυτής που βγαίνει τώρα (η δοκιμή δεν χρεώθηκε)
  const first = await db.subscriptionCharge.findFirst({ where: { subscriptionId: sub.id }, orderBy: { periodStart: "asc" }, select: { periodStart: true } });
  const billedFrom = first && first.periodStart < periodStart ? first.periodStart : periodStart;
  return { sub, plan, stores, periodStart, periodEnd, calc: chargeFor(plan, stores, now, periodEnd, billedFrom, sub.creditCents), devices: stores.reduce((n, s) => n + s.deviceKinds.length, 0) };
}
