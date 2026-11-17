// Βάση γνώσεων χωρίς βάση δεδομένων (για tests): αναζήτηση με λέξεις και απόδοση του απλού κειμένου των άρθρων.
// Η αναζήτηση εδώ είναι με λέξεις-κλειδιά· στο επόμενο βήμα (μνήμη) θα συνδυαστεί με διανύσματα.

/** Πεζά, χωρίς τόνους και διαλυτικά, τελικό σίγμα ίδιο με το μεσαίο: «Απόδειξης» και «αποδειξησ» ταιριάζουν. */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");
const STOP = new Set(["και", "να", "το", "τα", "τη", "την", "τον", "του", "τησ", "των", "ο", "η", "οι", "σε", "με", "για", "απο", "στο", "στη", "στην", "στον", "στα", "δεν", "που", "πωσ", "μου", "ειναι", "ενα", "μια", "the", "a", "to"]);
/** Οι λέξεις που μετράνε, κομμένες στη ρίζα τους (5 γράμματα) ώστε να πιάνονται οι καταλήξεις: εκτυπωτής / εκτυπωτή / εκτυπώνει. */
export const terms = (s: string) => [...new Set(fold(s).split(/[^a-z0-9α-ω]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)))];

type Doc = { title: string; body: string };
/** Πόσο ταιριάζει ένα άρθρο στην ερώτηση. Ο τίτλος μετρά τριπλά. 0 = άσχετο. */
export function score(query: string, doc: Doc) {
  const q = terms(query);
  if (!q.length) return 0;
  const title = fold(doc.title), body = fold(doc.body);
  let total = 0, hit = 0;
  for (const t of q) {
    const inTitle = title.includes(t), inBody = body.includes(t);
    if (inTitle || inBody) hit++;
    total += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
  }
  // τουλάχιστον οι μισές λέξεις της ερώτησης πρέπει να υπάρχουν, αλλιώς μια κοινή λέξη φέρνει άσχετα άρθρα
  return hit * 2 >= q.length ? total : 0;
}
export const search = <T extends Doc>(query: string, docs: T[], limit = 5) =>
  docs.map((d) => ({ d, s: score(query, d) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.d);

export type Block = { kind: "h" | "p"; text: string } | { kind: "ul" | "ol"; items: string[] };
/** Το κείμενο ενός άρθρου σε κομμάτια: «## » υπότιτλος, «- » λίστα, «1. » βήματα, αλλιώς παράγραφος. */
export function parseBody(body: string): Block[] {
  const out: Block[] = [];
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•]\s+(.*)$/.exec(line), step = /^\d+[.)]\s+(.*)$/.exec(line), last = out[out.length - 1];
    if (line.startsWith("## ")) out.push({ kind: "h", text: line.slice(3) });
    else if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else out.push({ kind: "ul", items: [bullet[1]] });
    } else if (step) {
      if (last?.kind === "ol") last.items.push(step[1]);
      else out.push({ kind: "ol", items: [step[1]] });
    }
    else out.push({ kind: "p", text: line });
  }
  return out;
}

export const KB_STATUS = { DRAFT: { tone: "neutral", text: "Πρόχειρο" }, REVIEW: { tone: "warning", text: "Προς έγκριση" }, PUBLISHED: { tone: "success", text: "Δημοσιευμένο" }, RETIRED: { tone: "neutral", text: "Αποσυρμένο" } } as const;

/** «Βοήθησε το 86%» ή null όταν δεν υπάρχουν αρκετές ψήφοι για να σημαίνει κάτι. */
export const helpful = (yes: number, no: number) => (yes + no >= 3 ? Math.round((yes / (yes + no)) * 100) : null);
