// Επιλογές μοντέλων από τον ζωντανό κατάλογο του OpenRouter και routing χαμηλού κόστους.
// Το κλειδί μένει στον server· στη φόρμα φτάνουν μόνο id, ονόματα και δημόσιες τιμές.
export const AUTO_MODEL = "openrouter/auto";
export const MODEL_ID = /^~?[a-z0-9._-]+\/[a-z0-9._:-]+$/i;
export type ModelOption = [value: string, text: string];

const base = () => (process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1").replace(/\/$/, "");

const pricePerMillion = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? String(Number((n * 1_000_000).toFixed(2))) : null;
};

/** Μετατρέπει μόνο έγκυρες εγγραφές του catalogue σε επιλογές· οι δυναμικοί routers με τιμή -1 παραλείπονται. */
export function catalogOptions(payload: unknown, kind: "chat" | "embed"): ModelOption[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const row of rows as { id?: unknown; name?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }[]) {
    if (!row || typeof row.id !== "string" || !MODEL_ID.test(row.id) || seen.has(row.id)) continue;
    const prompt = pricePerMillion(row.pricing?.prompt);
    // Το -1 δηλώνει router με άγνωστο τελικό κόστος, όχι δωρεάν μοντέλο.
    if (prompt === null) continue;
    const completion = pricePerMillion(row.pricing?.completion);
    const name = typeof row.name === "string" && row.name.trim() && row.name !== row.id ? `${row.name} — ` : "";
    const cost = kind === "chat" ? ` · $${prompt}/$${completion ?? "—"} ανά 1M tokens` : ` · $${prompt} ανά 1M tokens`;
    options.push([row.id, `${name}${row.id}${cost}`]);
    seen.add(row.id);
  }
  return options;
}

/** Αυστηρό απόρρητο σε κάθε κλήση· στην αυτόματη επιλογή ζητάμε χαμηλό κόστος μοντέλου και παρόχου. */
export function routingOptions(model: string, strict: boolean) {
  const provider = { ...(strict ? { data_collection: "deny", zdr: true } : {}), ...(model === AUTO_MODEL ? { sort: "price" } : {}) };
  return {
    ...(Object.keys(provider).length ? { provider } : {}),
    ...(model === AUTO_MODEL ? { plugins: [{ id: "auto-router", cost_tier: "low" }] } : {}),
  };
}

async function fetchOptions(path: string, key: string, kind: "chat" | "embed"): Promise<ModelOption[]> {
  const res = await fetch(`${base()}${path}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) throw new Error("catalog unavailable");
  const payload = await res.json().catch(() => null);
  if (!payload) throw new Error("invalid catalog");
  return catalogOptions(payload, kind);
}

/** Ο κατάλογος συνομιλίας ακολουθεί τα guardrails του κλειδιού· χωρίς κλειδί χρησιμοποιείται ο δημόσιος. */
export async function modelChoices(key: string): Promise<{ chat?: ModelOption[]; embed?: ModelOption[]; failed: string[] }> {
  const chatPath = `${key ? "/models/user" : "/models"}?output_modalities=text&endpoints=${encodeURIComponent("/api/v1/chat/completions")}&sort=pricing-low-to-high&limit=1000`;
  const [chat, embed] = await Promise.allSettled([
    fetchOptions(chatPath, key, "chat"),
    fetchOptions("/embeddings/models", key, "embed"),
  ]);
  return {
    chat: chat.status === "fulfilled" ? [[AUTO_MODEL, "Αυτόματη επιλογή — προτεραιότητα στο χαμηλότερο κόστος"], ...chat.value] : undefined,
    embed: embed.status === "fulfilled" ? embed.value : undefined,
    failed: [...(chat.status === "rejected" ? ["συνομιλίας"] : []), ...(embed.status === "rejected" ? ["embeddings"] : [])],
  };
}
