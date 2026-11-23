// Κανόνες εμπλουτισμού καταλόγου χωρίς δίκτυο και βάση: η απάντηση του AI είναι πρόταση,
// όχι αποδεικτικό. Δεκτά γίνονται μόνο στοιχεία που συνδέονται με τα δικά μας προϊόντα ή με επαληθευμένη σελίδα.
import { z } from "zod";
import { manufacturerMatchKeys, normalizeManufacturerName, sameManufacturer } from "./manufacturer.ts";

export const INGREDIENT_CATEGORIES = {
  dairy: "Γαλακτοκομικά",
  sugars: "Σάκχαρα",
  fats: "Λίπη",
  eggs: "Αυγά",
  chocolate: "Σοκολάτα & κακάο",
  nuts: "Ξηροί καρποί",
  fruit: "Φρούτα",
  flour: "Αλεύρια",
  starch: "Αμυλούχα",
  leavening: "Διογκωτικά",
  stabilizer: "Σταθεροποιητές",
  emulsifier: "Γαλακτωματοποιητές",
  flavor: "Αρώματα",
  other: "Λοιπά",
} as const;

export type IngredientCategory = keyof typeof INGREDIENT_CATEGORIES;
export type EnrichmentProduct = { id: string; name: string; ingredientsText?: string | null };
export type MergeCandidate = { id: string; name: string; aliases?: string[]; website?: string | null };

// Το web plugin παράγει citation όταν η απάντηση περιέχει markdown link· στο υπόλοιπο σύστημα περνά μόνο το URL.
const websiteSchema = z.string().trim().max(1000).transform((value) =>
  /\[[^\]]{1,200}\]\((https:\/\/[^)\s]+)\)/i.exec(value)?.[1] ?? value,
).nullable().catch(null).default(null);

const answerSchema = z.object({
  canonicalName: z.string().trim().min(2).max(100).nullable().catch(null).default(null),
  aliases: z.array(z.string().trim().min(2).max(100)).max(16).catch([]).default([]),
  website: websiteSchema,
  ingredients: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    category: z.enum(Object.keys(INGREDIENT_CATEGORIES) as [IngredientCategory, ...IngredientCategory[]]),
    isCore: z.boolean().catch(false).default(false),
    pastryRelevant: z.boolean().catch(false).default(false),
    evidence: z.string().trim().min(2).max(500),
    sourceItemIds: z.array(z.string().min(1).max(80)).min(1).max(20),
  })).max(30).catch([]).default([]),
  duplicates: z.array(z.object({
    manufacturerId: z.string().min(1).max(80),
    confidence: z.number().int().min(0).max(100),
    reason: z.string().trim().max(400).catch("").default(""),
  })).max(20).catch([]).default([]),
});

export type CatalogEnrichmentAnswer = z.infer<typeof answerSchema>;

/** Το μοντέλο περιβάλλει μερικές φορές το JSON με Markdown ή σύντομο κείμενο. */
export function parseCatalogEnrichment(raw: string): CatalogEnrichmentAnswer {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const from = text.indexOf("{"), to = text.lastIndexOf("}");
  if (from < 0 || to <= from) throw new Error("Το AI δεν επέστρεψε JSON");
  return answerSchema.parse(JSON.parse(text.slice(from, to + 1)));
}

export function normalizeIngredientName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").slice(0, 100);
}

export function safeHttpsUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export const siteHost = (value: string | URL | null | undefined) => {
  const url = typeof value === "string" || value instanceof URL ? safeHttpsUrl(String(value)) : value;
  return url?.hostname.toLowerCase().replace(/^www\./, "") ?? "";
};

export function sameSite(a: string | URL | null | undefined, b: string | URL | null | undefined) {
  const left = siteHost(a), right = siteHost(b);
  return !!left && !!right && (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`));
}

/** Μόνο υλικά με αυτούσιο απόσπασμα από προϊόν που πράγματι ανήκει στον κατασκευαστή. */
export function validatedIngredients(raw: CatalogEnrichmentAnswer["ingredients"], products: EnrichmentProduct[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const merged = new Map<string, { name: string; normalizedName: string; category: IngredientCategory; isCore: boolean; pastryRelevant: boolean; evidence: string; productIds: string[] }>();
  for (const ingredient of raw) {
    const sourceIds = [...new Set(ingredient.sourceItemIds)].filter((id) => byId.has(id));
    const evidenceProduct = sourceIds.map((id) => byId.get(id)!).find((p) => p.name.includes(ingredient.evidence) || p.ingredientsText?.includes(ingredient.evidence));
    const normalizedName = normalizeIngredientName(ingredient.name);
    if (!evidenceProduct || !normalizedName) continue;
    const old = merged.get(normalizedName);
    if (old) {
      old.isCore ||= ingredient.isCore;
      old.pastryRelevant ||= ingredient.pastryRelevant;
      old.productIds = [...new Set([...old.productIds, ...sourceIds])];
    } else {
      merged.set(normalizedName, { name: ingredient.name.replace(/\s+/g, " "), normalizedName, category: ingredient.category, isCore: ingredient.isCore, pastryRelevant: ingredient.pastryRelevant, evidence: ingredient.evidence, productIds: sourceIds });
    }
  }
  return [...merged.values()];
}

/** Το AI δεν μπορεί να επινοήσει ζεύγος: μόνο δοσμένοι υποψήφιοι με ίδια ταυτότητα ή κοινό domain. */
export function validatedMergeSuggestions(raw: CatalogEnrichmentAnswer["duplicates"], current: MergeCandidate, candidates: MergeCandidate[]) {
  const byId = new Map(candidates.filter((c) => c.id !== current.id).map((c) => [c.id, c]));
  const names = [current.name, ...(current.aliases ?? [])];
  const output = new Map<string, { targetId: string; confidence: number; reason: string }>();
  for (const suggestion of raw) {
    const candidate = byId.get(suggestion.manufacturerId);
    if (!candidate || suggestion.confidence < 85) continue;
    const sameIdentity = names.some((name) => sameManufacturer(name, candidate.name) || (candidate.aliases ?? []).some((alias) => sameManufacturer(name, alias)));
    const sameDomain = sameSite(current.website, candidate.website);
    if (!sameIdentity && !sameDomain) continue;
    output.set(candidate.id, { targetId: candidate.id, confidence: suggestion.confidence, reason: suggestion.reason || "Πιθανή ίδια ταυτότητα από το AI" });
  }
  return [...output.values()];
}

export function validatedAliases(answer: Pick<CatalogEnrichmentAnswer, "canonicalName" | "aliases">, currentName: string) {
  const currentKeys = new Set(manufacturerMatchKeys(currentName));
  return [...new Set([answer.canonicalName, ...answer.aliases]
    .filter((name): name is string => !!name)
    .map(normalizeManufacturerName)
    .filter((name) => name.length >= 2 && !manufacturerMatchKeys(name).some((key) => currentKeys.has(key))))].slice(0, 16);
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const decode = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity: string) => {
  if (entity[0] === "#") {
    const code = Number.parseInt(entity.slice(entity[1]?.toLowerCase() === "x" ? 2 : 1), entity[1]?.toLowerCase() === "x" ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  }
  return ENTITIES[entity.toLowerCase()] ?? all;
});

function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

function logoValue(value: unknown, depth = 0): string[] {
  if (depth > 8 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => logoValue(v, depth + 1));
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return [...logoValue(object.url, depth + 1), ...logoValue(object.contentUrl, depth + 1), ...logoValue(object.logo, depth + 1), ...logoValue(object.image, depth + 1)];
  }
  return [];
}

/** Υποψήφια λογότυπα μόνο από το επαληθευμένο HTML· ποτέ από ελεύθερο URL της απάντησης AI. */
export function extractLogoCandidates(html: string, pageUrl: string) {
  const base = safeHttpsUrl(pageUrl);
  if (!base) return [];
  const scored = new Map<string, number>();
  const add = (value: string | undefined, score: number) => {
    if (!value) return;
    try {
      const url = safeHttpsUrl(new URL(decode(value), base).toString());
      if (url) scored.set(url.toString(), Math.max(score, scored.get(url.toString()) ?? 0));
    } catch { /* τα σπασμένα URLs της σελίδας αγνοούνται */ }
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/ld\+json/i.test(match[1])) continue;
    try {
      const json = JSON.parse(match[2].trim()) as unknown;
      add(logoValue(json)[0], 100);
    } catch { /* ένα λανθασμένο JSON-LD δεν ακυρώνει τα υπόλοιπα */ }
  }
  for (const match of html.matchAll(/<(?:img|link|meta)\b[^>]*>/gi)) {
    const tag = match[0], a = attributes(tag);
    if (/^img$/i.test(tag.slice(1, 4)) && /logo/i.test([a.id, a.class, a.alt, a.src, a["data-src"]].join(" "))) add(a.src ?? a["data-src"], 90);
    if (/\b(?:icon|apple-touch-icon)\b/i.test(a.rel ?? "")) add(a.href, 50);
    if (/^(?:og:image|twitter:image)$/i.test(a.property ?? a.name ?? "")) add(a.content, 30);
  }
  return [...scored].sort((a, b) => b[1] - a[1]).map(([url]) => url).slice(0, 12);
}

/** Η σελίδα πρέπει να αναφέρει τον κατασκευαστή ή κάποιο brand· δεν αρκεί ένα πειστικό domain. */
export function pageMentionsIdentity(html: string, names: string[]) {
  const text = normalizeIngredientName(decode(html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ").replace(/<[^>]+>/g, " ")));
  const ignored = new Set(["AE", "AEBE", "SA", "LTD", "LIMITED", "COMPANY", "GMBH", "SRL", "SPA", "INC", "LLC", "FOOD", "FOODS"]);
  return names.some((name) => {
    const normalized = normalizeIngredientName(name);
    if (normalized.length >= 3 && text.includes(normalized)) return true;
    return normalized.split(" ").some((token) => token.length >= 4 && !ignored.has(token) && new RegExp(`(?:^| )${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(text));
  });
}
