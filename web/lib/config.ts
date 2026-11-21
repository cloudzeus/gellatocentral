// Ρυθμίσεις σύνδεσης της πλατφόρμας (Viva, Mailgun, Bunny, διεύθυνση εφαρμογής). Ορίζονται από την οθόνη
// «Ρυθμίσεις» και φυλάσσονται στη βάση (πίνακας Setting). Στο .env μένουν μόνο όσα χρειάζονται για να ξεκινήσει
// ο server: DATABASE_URL, ο πρώτος διαχειριστής (ADMIN_EMAIL/ADMIN_PASSWORD) και το TRUST_PROXY.
// Αν μια τιμή λείπει από τη βάση, ισχύει η μεταβλητή περιβάλλοντος με το ίδιο όνομα (παλιές εγκαταστάσεις, scripts).
import { db } from "./db";

type Def = { label: string; hint?: string; placeholder?: string; secret?: true; options?: [value: string, text: string][]; check?: [RegExp, string] };
const https: [RegExp, string] = [/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i, "γράφεται ολόκληρη και αρχίζει με https://"];

/** Οι ομάδες και τα πεδία τους, με τη σειρά που φαίνονται στην οθόνη. Νέα ρύθμιση = μία γραμμή εδώ. */
export const GROUPS = {
  viva_isv: {
    title: "Viva ISV: πληρωμές και τιμολόγηση των πελατών",
    hint: "Τα κλειδιά του λογαριασμού ISV. Με αυτά τα ταμεία όλων των πελατών στέλνουν πληρωμές στα τερματικά και διαβιβάζουν αποδείξεις",
    fields: {
      VIVA_ENV: { label: "Περιβάλλον Viva", hint: "Ισχύει και για την είσπραξη συνδρομών", options: [["demo", "Demo (δοκιμές)"], ["production", "Παραγωγή (πραγματικές συναλλαγές)"]] },
      VIVA_ISV_CLIENT_ID: { label: "Client ID" },
      VIVA_ISV_CLIENT_SECRET: { label: "Client Secret", secret: true },
    },
  },
  viva_platform: {
    title: "Λογαριασμός Viva για τις συνδρομές",
    hint: "Smart Checkout: εδώ πληρώνουν οι πελάτες τη συνδρομή τους. Στην πηγή πληρωμών της Viva όρισε Success URL: <διεύθυνση εφαρμογής>/billing/paid",
    fields: {
      VIVA_PLATFORM_CLIENT_ID: { label: "Client ID" },
      VIVA_PLATFORM_CLIENT_SECRET: { label: "Client Secret", secret: true },
      VIVA_PLATFORM_SOURCE_CODE: { label: "Κωδικός πηγής πληρωμών", hint: "Προαιρετικά: τέσσερα ψηφία, από Πωλήσεις › Online πληρωμές › Ιστοσελίδες", check: [/^\d{4}$/, "έχει τέσσερα ψηφία"] },
    },
  },
  mailgun: {
    title: "Mailgun: αποστολή email",
    hint: "Ένας επαληθευμένος τομέας για όλη την πλατφόρμα. Κάθε πελάτης στέλνει ως υποτομέας@τομέας",
    fields: {
      MAILGUN_API_KEY: { label: "Κλειδί API", secret: true },
      MAILGUN_DOMAIN: { label: "Τομέας αποστολής", placeholder: "mg.gelatosystem.app", check: [/^([a-z0-9-]+\.)+[a-z]{2,}$/, "γράφεται χωρίς https://, π.χ. mg.gelatosystem.app"] },
      MAILGUN_REGION: { label: "Περιοχή", options: [["eu", "Ευρώπη"], ["us", "ΗΠΑ"]] },
    },
  },
  bunny: {
    title: "Bunny: αποθήκευση αρχείων",
    hint: "Φωτογραφίες, έγγραφα και αντίγραφα ασφαλείας. Κάθε πελάτης έχει δικό του φάκελο: orgs/<πελάτης>/…",
    fields: {
      BUNNY_STORAGE_ZONE: { label: "Όνομα storage zone", placeholder: "gelato-files", hint: "Bunny › Storage › η ζώνη σου › FTP & API Access › Username", check: [/^[a-z0-9-]+$/, "έχει μόνο πεζά λατινικά, ψηφία και παύλες"] },
      BUNNY_STORAGE_KEY: { label: "Κωδικός της ζώνης", secret: true, hint: "FTP & API Access › Password" },
      BUNNY_STORAGE_REGION: { label: "Περιοχή της ζώνης", options: [["", "Falkenstein, Γερμανία (προεπιλογή)"], ["uk", "Λονδίνο"], ["se", "Στοκχόλμη"], ["ny", "Νέα Υόρκη"], ["la", "Λος Άντζελες"], ["sg", "Σιγκαπούρη"], ["syd", "Σίδνεϊ"], ["br", "Σάο Πάολο"], ["jh", "Γιοχάνεσμπουργκ"]] },
      BUNNY_CDN_URL: { label: "Διεύθυνση CDN (pull zone)", placeholder: "https://gelato.b-cdn.net", hint: "Από εδώ σερβίρονται οι φωτογραφίες. Χωρίς αυτήν περνούν μέσα από την εφαρμογή, πιο αργά", check: https },
    },
  },
  rustdesk: {
    title: "RustDesk: απομακρυσμένη υποστήριξη",
    hint: "Ο δικός μας server RustDesk. Με αυτά τα στοιχεία ρυθμίζεται το πρόγραμμα RustDesk στις συσκευές των πελατών και στους υπολογιστές της υποστήριξης",
    fields: {
      RUSTDESK_SERVER: { label: "Διεύθυνση server (ID server)", placeholder: "rd.gelatosystem.app", check: [/^[a-z0-9.-]+(:\d{2,5})?$/i, "γράφεται χωρίς https://, π.χ. rd.gelatosystem.app"] },
      RUSTDESK_KEY: { label: "Δημόσιο κλειδί server", hint: "Το περιεχόμενο του id_ed25519.pub. Δεν είναι μυστικό: μπαίνει σε κάθε πρόγραμμα RustDesk" },
      RUSTDESK_LINK: { label: "Μορφή συνδέσμου", placeholder: "rustdesk://{id}", hint: "Ο σύνδεσμος που ανοίγει το RustDesk στον υπολογιστή του τεχνικού. Το {id} γίνεται ο αριθμός της συσκευής", check: [/^[a-z][a-z0-9+.-]*:\/\/\S*\{id\}\S*$/i, "πρέπει να περιέχει {id}, π.χ. rustdesk://{id}"] },
    },
  },
  openrouter: {
    title: "OpenRouter: βοηθός υποστήριξης (agent)",
    hint: "Ο agent γράφει προσχέδια απαντήσεων στα αιτήματα και ψάχνει τη βάση γνώσεων με το νόημα, όχι μόνο με λέξεις. Πριν φύγει κείμενο, αφαιρούνται email, τηλέφωνα και ΑΦΜ",
    fields: {
      OPENROUTER_API_KEY: { label: "Κλειδί API", secret: true },
      OPENROUTER_CHAT_MODEL: { label: "Μοντέλο συνομιλίας", placeholder: "π.χ. anthropic/claude-sonnet-4.5", hint: "Το όνομα όπως το γράφει το OpenRouter (openrouter.ai/models)", check: [/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i, "γράφεται ως πάροχος/μοντέλο"] },
      OPENROUTER_EMBED_MODEL: { label: "Μοντέλο embeddings", placeholder: "π.χ. openai/text-embedding-3-small", hint: "Για την αναζήτηση με νόημα. Αν το αλλάξεις, πάτα «Ενημέρωση μνήμης» στη Βάση γνώσεων", check: [/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i, "γράφεται ως πάροχος/μοντέλο"] },
      OPENROUTER_PRIVACY: { label: "Πάροχοι", options: [["strict", "Μόνο όσοι δεν κρατούν δεδομένα (προτείνεται)"], ["any", "Οποιοσδήποτε πάροχος"]] },
      AGENT_LEVEL: { label: "Τι κάνει ο agent", options: [["0", "Τίποτα (κλειστός)"], ["1", "Βοηθός υπαλλήλου: προσχέδιο που στέλνει άνθρωπος"]] },
      AGENT_BUDGET_USD: { label: "Μηνιαίο όριο κόστους (USD)", placeholder: "π.χ. 50", hint: "Όταν ξεπεραστεί, ο agent σταματά μέχρι τον επόμενο μήνα. Κενό = χωρίς προσχέδια", check: [/^\d{1,5}(\.\d{1,2})?$/, "είναι αριθμός, π.χ. 50"] },
    },
  },
  app: {
    title: "Εφαρμογή",
    hint: "Η δημόσια διεύθυνση (για τους συνδέσμους στα email) και το μυστικό των προγραμματισμένων εργασιών",
    fields: {
      APP_URL: { label: "Διεύθυνση εφαρμογής", placeholder: "https://app.gelatosystem.app", check: https },
      PLATFORM_VAT: { label: "ΑΦΜ της εταιρείας μας", placeholder: "9 ψηφία", hint: "Με αυτό το VIES δίνει αριθμό ελέγχου όταν η πλατφόρμα ελέγχει ΑΦΜ άλλης χώρας της ΕΕ", check: [/^\d{9}$/, "έχει 9 ψηφία"] },
      CRON_SECRET: { label: "Μυστικό προγραμματισμένων εργασιών", secret: true, hint: "Τουλάχιστον 20 χαρακτήρες. Το ίδιο στέλνει ο cron στο /api/cron/subscriptions", check: [/^\S{20,}$/, "θέλει τουλάχιστον 20 χαρακτήρες χωρίς κενά"] },
      USD_EUR_RATE: { label: "Ισοτιμία USD → EUR", placeholder: "π.χ. 0.92", hint: "Για τη χρέωση των pay-as-you-go υπηρεσιών (OCR κ.ά.): το κόστος των παρόχων τιμολογείται σε USD. Κενό = 0,92", check: [/^\d(\.\d{1,4})?$/, "είναι αριθμός, π.χ. 0.92"] },
    },
  },
} as const satisfies Record<string, { title: string; hint: string; fields: Record<string, Def> }>;
export type Group = keyof typeof GROUPS;
type Fields = { [G in Group]: keyof (typeof GROUPS)[G]["fields"] }[Group];
export type SettingKey = Fields;
export const fieldsOf = (g: Group) => Object.entries(GROUPS[g].fields) as [SettingKey, Def][];

// Μικρή μνήμη στη διεργασία (5″): οι ρυθμίσεις διαβάζονται σε κάθε αίτημα. Με πολλούς κόμβους, μια αλλαγή φτάνει παντού σε λίγα δευτερόλεπτα.
let memo: { at: number; values: Record<string, string> } | undefined;
async function stored() {
  if (memo && Date.now() - memo.at < 5000) return memo.values;
  const values = Object.fromEntries((await db.setting.findMany()).map((s) => [s.key, s.value]));
  memo = { at: Date.now(), values };
  return values;
}

/** Η τιμή μιας ρύθμισης: από τη βάση, αλλιώς από το περιβάλλον, αλλιώς κενό. */
export const setting = async (key: SettingKey) => (await stored())[key] ?? process.env[key]?.trim() ?? "";
export const settings = async <K extends SettingKey>(...keys: K[]) => { const s = await stored(); return Object.fromEntries(keys.map((k) => [k, s[k] ?? process.env[k]?.trim() ?? ""])) as Record<K, string>; };

/**
 * Αποθηκεύει τα πεδία μιας ομάδας. Επιστρέφει μήνυμα λάθους ή null. Κενό μυστικό πεδίο = μένει η τιμή που υπάρχει
 * (η φόρμα δεν δείχνει ποτέ τα μυστικά, άρα δεν μπορεί να τα ξαναστείλει)· κενό απλό πεδίο = σβήνεται.
 */
export async function saveGroup(group: Group, form: FormData): Promise<string | null> {
  const changes: [SettingKey, string][] = [];
  for (const [key, def] of fieldsOf(group)) {
    const value = String(form.get(key) ?? "").trim().slice(0, 400);
    if (!value && def.secret) continue;
    if (value && def.options && !def.options.some(([v]) => v === value)) return `${def.label}: άγνωστη επιλογή`;
    if (value && def.check && !def.check[0].test(value)) return `${def.label}: ${def.check[1]}`;
    changes.push([key, value]);
  }
  await db.$transaction(changes.map(([key, value]) => (value ? db.setting.upsert({ where: { key }, update: { value }, create: { key, value } }) : db.setting.deleteMany({ where: { key } }))));
  memo = undefined;
  return null;
}
