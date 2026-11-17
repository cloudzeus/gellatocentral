// Κανόνες του agent χωρίς δίκτυο και βάση (για tests): καθαρισμός προσωπικών στοιχείων, κόψιμο κειμένου σε κομμάτια,
// ανάγνωση της απάντησης του μοντέλου.

/**
 * Αφαιρεί ό,τι ταυτοποιεί πρόσωπο πριν φύγει κείμενο προς τρίτο: email, τηλέφωνα, ΑΦΜ, αριθμούς καρτών και IBAN.
 * Τα ονόματα δεν πιάνονται με κανόνες· γι' αυτό στο μοντέλο δεν δίνεται ποτέ όνομα πελάτη ή χρήστη από τη βάση.
 */
export function scrub(text: string) {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/g, "[IBAN]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[αριθμός κάρτας]")
    .replace(/(?:\+30|0030)?[ ]?\b(?:2\d|69)\d(?:[ -]?\d){7}\b/g, "[τηλέφωνο]")
    .replace(/\bΑΦΜ[:\s]*\d{9}\b/gi, "ΑΦΜ [ΑΦΜ]")
    .replace(/\b\d{9}\b/g, "[9ψήφιος αριθμός]");
}

/** Κόβει ένα άρθρο σε κομμάτια για τη μνήμη: ανά ενότητα («## »), και ό,τι είναι μεγάλο ανά παραγράφους έως ~900 χαρακτήρες. */
export function chunk(body: string, max = 900): string[] {
  const out: string[] = [];
  for (const section of body.replace(/\r/g, "").split(/\n(?=## )/)) {
    let current = "";
    for (const para of section.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
      if (current && current.length + para.length + 2 > max) { out.push(current); current = ""; }
      current = current ? `${current}\n\n${para}` : para;
    }
    if (current) out.push(current);
  }
  return out;
}

export type Draft = { reply: string; note: string | null; confidence: "high" | "medium" | "low"; sources: number[] };
/** Η απάντηση του μοντέλου είναι JSON, μερικές φορές μέσα σε ```json … ```. Ό,τι δεν διαβάζεται γίνεται προσχέδιο χαμηλής βεβαιότητας. */
export function parseDraft(raw: string, sourceCount: number): Draft {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const reply = typeof j.reply === "string" ? j.reply.trim() : "";
    if (!reply) throw new Error("empty");
    const sources = Array.isArray(j.sources) ? [...new Set(j.sources.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount))] : [];
    const said = j.confidence === "high" || j.confidence === "medium" || j.confidence === "low" ? j.confidence : "low";
    // χωρίς πηγή που να τη στηρίζει, μια απάντηση δεν είναι ποτέ «υψηλής βεβαιότητας»
    return { reply: reply.slice(0, 4000), note: typeof j.note === "string" && j.note.trim() ? j.note.trim().slice(0, 1000) : null, confidence: said === "high" && sources.length === 0 ? "medium" : said, sources };
  } catch {
    return { reply: raw.trim().slice(0, 4000), note: "Το μοντέλο δεν απάντησε στη μορφή που ζητήθηκε. Διάβασέ το προσεκτικά πριν το στείλεις", confidence: "low", sources: [] };
  }
}

/** Διάνυσμα ως κείμενο για το pgvector. Απορρίπτει ό,τι δεν είναι πεπερασμένος αριθμός (το κείμενο μπαίνει σε SQL). */
export function vectorLiteral(v: number[]) {
  if (!v.length || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new Error("Άκυρο διάνυσμα");
  return `[${v.join(",")}]`;
}
