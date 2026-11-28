// OpenRouter (https://openrouter.ai/docs): συνομιλία και embeddings με το ίδιο κλειδί. Κλειδί και μοντέλα ορίζονται
// στις Ρυθμίσεις. ΚΑΘΕ κείμενο που φεύγει από εδώ περνά πρώτα από το scrub(): email, τηλέφωνα, ΑΦΜ, κάρτες δεν στέλνονται.
import { settings } from "../config";
import { routingOptions } from "./openrouter-options";
import { scrub } from "./rules";

// OPENROUTER_ENDPOINT: μόνο για δοκιμές απέναντι σε τοπικό server
const base = () => (process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1").replace(/\/$/, "");
export async function aiConfig() {
  const c = await settings("OPENROUTER_API_KEY", "OPENROUTER_CHAT_MODEL", "OPENROUTER_EMBED_MODEL", "OPENROUTER_PRIVACY", "AGENT_LEVEL", "AGENT_BUDGET_USD");
  return { key: c.OPENROUTER_API_KEY, chatModel: c.OPENROUTER_CHAT_MODEL, embedModel: c.OPENROUTER_EMBED_MODEL, strict: c.OPENROUTER_PRIVACY !== "any", level: Number(c.AGENT_LEVEL) || 0, budgetUsd: Number(c.AGENT_BUDGET_USD) || 0, memory: !!(c.OPENROUTER_API_KEY && c.OPENROUTER_EMBED_MODEL), chat: !!(c.OPENROUTER_API_KEY && c.OPENROUTER_CHAT_MODEL) };
}
export class AiError extends Error {}

async function call(path: string, key: string, body: object) {
  const res = await fetch(`${base()}${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res) throw new AiError("Το OpenRouter δεν απάντησε");
  if (!res.ok) throw new AiError(res.status === 401 ? "Το OpenRouter απέρριψε το κλειδί" : res.status === 402 ? "Το υπόλοιπο στο OpenRouter τελείωσε" : res.status === 404 ? "Το μοντέλο δεν βρέθηκε, ή κανένας πάροχός του δεν πληροί τη ρύθμιση «χωρίς διατήρηση δεδομένων»" : `Το OpenRouter απάντησε ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Διανύσματα για κάθε κείμενο, με την ίδια σειρά. */
export async function embed(texts: string[]): Promise<{ vectors: number[][]; model: string; costUsd: number }> {
  const c = await aiConfig();
  if (!c.memory) throw new AiError("Δεν έχει οριστεί κλειδί ή μοντέλο embeddings");
  const j = await call("/embeddings", c.key, { model: c.embedModel, input: texts.map((t) => scrub(t).slice(0, 8000)), ...routingOptions(c.embedModel, c.strict) });
  const data = j.data as { embedding: number[]; index?: number }[] | undefined;
  if (!Array.isArray(data) || data.length !== texts.length) throw new AiError("Το OpenRouter δεν επέστρεψε διανύσματα");
  return { vectors: [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding), model: c.embedModel, costUsd: Number((j.usage as { cost?: number } | undefined)?.cost) || 0 };
}

export async function chat(system: string, user: string): Promise<{ text: string; model: string; promptTokens: number; completionTokens: number; costUsd: number }> {
  const c = await aiConfig();
  if (!c.chat) throw new AiError("Δεν έχει οριστεί κλειδί ή μοντέλο συνομιλίας");
  const j = await call("/chat/completions", c.key, { model: c.chatModel, messages: [{ role: "system", content: system }, { role: "user", content: scrub(user) }], temperature: 0.2, max_tokens: 6000, /* τα μοντέλα με σκέψη ξοδεύουν tokens πριν γράψουν */ usage: { include: true }, ...routingOptions(c.chatModel, c.strict) });
  const text = (j.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content;
  if (!text) throw new AiError("Το μοντέλο δεν έδωσε απάντηση");
  const u = (j.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  return { text, model: typeof j.model === "string" ? j.model : c.chatModel, promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, costUsd: Number(u.cost) || 0 };
}

export type WebCitation = { url: string; title: string | null };

/** Web αναζήτηση του OpenRouter· τα citations ταξιδεύουν μαζί με το κείμενο για server-side επαλήθευση. */
export async function chatWithWeb(system: string, user: string): Promise<{ text: string; citations: WebCitation[]; model: string; promptTokens: number; completionTokens: number; costUsd: number }> {
  const c = await aiConfig();
  if (!c.chat) throw new AiError("Δεν έχει οριστεί κλειδί ή μοντέλο συνομιλίας");
  const j = await call("/chat/completions", c.key, {
    model: c.chatModel,
    messages: [{ role: "system", content: system }, { role: "user", content: scrub(user) }],
    temperature: 0.1,
    max_tokens: 6000,
    usage: { include: true },
    // Το plugin εκτελεί πάντα μία αναζήτηση και επιστρέφει τα standardized url_citation annotations.
    ...routingOptions(c.chatModel, c.strict, [{ id: "web", max_results: 5 }]),
  });
  const message = (j.choices as { message?: { content?: string; annotations?: unknown[] } }[] | undefined)?.[0]?.message;
  if (!message?.content) throw new AiError("Το μοντέλο δεν έδωσε απάντηση");
  const citations = (message.annotations ?? []).flatMap((annotation): WebCitation[] => {
    if (!annotation || typeof annotation !== "object") return [];
    const value = (annotation as { url_citation?: { url?: unknown; title?: unknown } }).url_citation;
    return typeof value?.url === "string" ? [{ url: value.url, title: typeof value.title === "string" ? value.title : null }] : [];
  });
  const u = (j.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  return { text: message.content, citations, model: typeof j.model === "string" ? j.model : c.chatModel, promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, costUsd: Number(u.cost) || 0 };
}

/** Μοντέλο όρασης: μια εικόνα ή PDF (data URL) και οδηγία εξαγωγής. Το αρχείο δεν περνά από scrub — δεν είναι κείμενο. */
export async function vision(system: string, prompt: string, imageDataUrl: string): Promise<{ text: string; model: string; promptTokens: number; completionTokens: number; costUsd: number }> {
  const c = await aiConfig();
  if (!c.chat) throw new AiError("Δεν έχει οριστεί κλειδί ή μοντέλο συνομιλίας");
  const j = await call("/chat/completions", c.key, {
    model: c.chatModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: prompt }, imageDataUrl.startsWith("data:application/pdf")
        ? { type: "file", file: { filename: "document.pdf", file_data: imageDataUrl } } // το OpenRouter διαβάζει PDF απευθείας
        : { type: "image_url", image_url: { url: imageDataUrl } }] },
    ],
    temperature: 0.1,
    max_tokens: 4000,
    usage: { include: true },
    ...routingOptions(c.chatModel, c.strict),
  });
  const text = (j.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content;
  if (!text) throw new AiError("Το μοντέλο δεν έδωσε απάντηση");
  const u = (j.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  return { text, model: typeof j.model === "string" ? j.model : c.chatModel, promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, costUsd: Number(u.cost) || 0 };
}

/** Δοκιμή: ένα μικρό διάνυσμα και μια λέξη από το μοντέλο συνομιλίας. */
export async function pingAi(): Promise<{ ok: boolean; text: string }> {
  try {
    const e = await embed(["δοκιμή σύνδεσης"]);
    const r = await chat("Απάντησε μόνο με τη λέξη: εντάξει", "δοκιμή");
    return { ok: true, text: `Το OpenRouter απάντησε: embeddings ${e.vectors[0].length} διαστάσεων (${e.model}), συνομιλία με ${r.model}` };
  } catch (e) {
    return { ok: false, text: e instanceof AiError ? e.message : "Η δοκιμή απέτυχε" };
  }
}
