// Λίστες αναφοράς (RefItem): κοινές για όλους, τις ορίζει η πλατφόρμα. Εδώ διαβάζονται όπως τις θέλουν οι φόρμες.
// Χώρες/γεωγραφία ζουν στα Geo* μοντέλα (lib/geo)· οι τρόποι πληρωμής στο PaymentMethod (lib/payment-methods).
// Οι μονάδες μέτρησης ζουν στο Unit (migration units_and_trade_items) — δεν είναι πια RefItem.
import { cache } from "react";
import { db } from "./db";
import { geoCountries } from "./geo";
import { paymentMethods } from "./payment-methods";

export const REF_LISTS = {
  taxOffice: { label: "ΔΟΥ", hint: "Προαιρετική: η ΔΟΥ έρχεται και από την αναζήτηση ΑΦΜ", value: null },
  paymentTerm: { label: "Όροι πληρωμής", hint: "Ο κωδικός είναι οι ημέρες πίστωσης", value: "Ημέρες" },
} as const;
export type RefList = keyof typeof REF_LISTS;
export const isRefList = (v: unknown): v is RefList => typeof v === "string" && v in REF_LISTS;

export const refItems = cache((list: RefList) => db.refItem.findMany({ where: { list, active: true }, orderBy: [{ sort: "asc" }, { label: "asc" }] }));
/** Ό,τι χρειάζεται η φόρμα συναλλασσομένου. */
export const partyRefs = cache(async () => {
  const [countries, methods, terms] = await Promise.all([geoCountries(), paymentMethods(), refItems("paymentTerm")]);
  const pair = (r: { code: string; label: string }): [string, string] => [r.code, r.label];
  return { countries, methods: methods.map((m): [string, string] => [m.id, m.name]), terms: terms.map(pair) };
});
