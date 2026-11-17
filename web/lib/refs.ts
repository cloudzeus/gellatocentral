// Λίστες αναφοράς (RefItem): κοινές για όλους, τις ορίζει η πλατφόρμα. Εδώ διαβάζονται όπως τις θέλουν οι φόρμες.
import { cache } from "react";
import { db } from "./db";

export const REF_LISTS = {
  country: { label: "Χώρες", hint: "Κωδικός ISO δύο γραμμάτων", value: null },
  region: { label: "Περιοχές", hint: "Περιφέρειες ή νομοί, για αναφορές ανά περιοχή", value: null },
  taxOffice: { label: "ΔΟΥ", hint: "Προαιρετική: η ΔΟΥ έρχεται και από την αναζήτηση ΑΦΜ", value: null },
  paymentMethod: { label: "Τρόποι πληρωμής", hint: "Κωδικοί όπως στο myDATA", value: null },
  paymentTerm: { label: "Όροι πληρωμής", hint: "Ο κωδικός είναι οι ημέρες πίστωσης", value: "Ημέρες" },
  vatCategory: { label: "Κατηγορίες ΦΠΑ", hint: "Κωδικοί όπως στο myDATA", value: "Ποσοστό × 100" },
  unit: { label: "Μονάδες μέτρησης", hint: "Για είδη, συνταγές και αποθήκη", value: null },
} as const;
export type RefList = keyof typeof REF_LISTS;
export const isRefList = (v: unknown): v is RefList => typeof v === "string" && v in REF_LISTS;

export const refItems = cache((list: RefList) => db.refItem.findMany({ where: { list, active: true }, orderBy: [{ sort: "asc" }, { label: "asc" }] }));
/** Ό,τι χρειάζεται η φόρμα συναλλασσόμενου. */
export const partyRefs = cache(async () => {
  const [countries, regions, methods, terms] = await Promise.all([refItems("country"), refItems("region"), refItems("paymentMethod"), refItems("paymentTerm")]);
  const pair = (r: { code: string; label: string }): [string, string] => [r.code, r.label];
  return { countries: countries.map(pair), regions: regions.map((r) => r.label), methods: methods.map(pair), terms: terms.map(pair) };
});
