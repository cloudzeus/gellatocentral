// Οι συνδέσεις της πλατφόρμας με τρίτους (Viva, Mailgun, Bunny) και τα στοιχεία της εφαρμογής, σε μία οθόνη.
// Κάθε ομάδα είναι μία κάρτα: αν είναι έτοιμη, τι έχει οριστεί, αλλαγή σε παράθυρο και, όπου γίνεται, δοκιμή.
// Τα μυστικά πεδία γράφονται αλλά δεν διαβάζονται ποτέ πίσω: η οθόνη δείχνει μόνο αν έχουν οριστεί.
import { CircleAlert, CircleCheck } from "lucide-react";
import { saveConnection, testConnection } from "@/app/(app)/platform/actions";
import { AUTO_MODEL, modelChoices, type ModelOption } from "@/lib/ai/openrouter-options";
import { fieldsOf, type Group, GROUPS, type SettingKey, settings } from "@/lib/config";
import { Modal } from "./modal";
import { Submit } from "./submit";
import { Badge, btn, Card, Field, Select } from "./ui";

/** Τι πρέπει να έχει οριστεί για να θεωρείται η ομάδα έτοιμη, και τι σημαίνει όταν δεν είναι. */
const NEEDS: Record<Group, { keys: SettingKey[]; missing: string; test?: string }> = {
  viva_isv: { keys: ["VIVA_ISV_CLIENT_ID", "VIVA_ISV_CLIENT_SECRET"], missing: "Χωρίς αυτά όλα τα ταμεία δουλεύουν δοκιμαστικά και δεν διαβιβάζουν αποδείξεις", test: "Δοκιμή σύνδεσης" },
  viva_platform: { keys: ["VIVA_PLATFORM_CLIENT_ID", "VIVA_PLATFORM_CLIENT_SECRET"], missing: "Χωρίς αυτά οι χρεώσεις εξοφλούνται μόνο χειροκίνητα, από την καρτέλα του συνδρομητή" },
  mailgun: { keys: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"], missing: "Χωρίς αυτά τα email μόνο καταγράφονται, δεν φεύγουν", test: "Δοκιμαστικό email σε μένα" },
  bunny: { keys: ["BUNNY_STORAGE_ZONE", "BUNNY_STORAGE_KEY"], missing: "Χωρίς αυτά δεν ανεβαίνουν αρχεία ούτε αντίγραφα ασφαλείας", test: "Δοκιμή σύνδεσης" },
  rustdesk: { keys: ["RUSTDESK_SERVER"], missing: "Χωρίς server οι συνδέσεις περνούν από τον δημόσιο server του RustDesk" },
  openrouter: { keys: ["OPENROUTER_API_KEY", "OPENROUTER_CHAT_MODEL", "OPENROUTER_EMBED_MODEL"], missing: "Χωρίς αυτά δεν υπάρχουν προσχέδια απαντήσεων και η αναζήτηση γίνεται μόνο με λέξεις", test: "Δοκιμή σύνδεσης" },
  app: { keys: ["APP_URL"], missing: "Χωρίς διεύθυνση, οι σύνδεσμοι στα email δείχνουν στο localhost" },
};

// Ένα αποθηκευμένο μοντέλο παραμένει ορατό ακόμη κι αν αποσυρθεί προσωρινά από τον κατάλογο.
const keepCurrent = (options: ModelOption[], current: string): ModelOption[] => current && !options.some(([value]) => value === current) ? [[current, `${current} (αποθηκευμένο)`], ...options] : options;

export async function Connections({ q }: { q: Record<string, string | string[] | undefined> }) {
  const all = await settings(...(Object.keys(GROUPS) as Group[]).flatMap((g) => fieldsOf(g).map(([k]) => k)));
  const openRouter = await modelChoices(all.OPENROUTER_API_KEY);
  return (
    <>
      {(Object.keys(GROUPS) as Group[]).map((g) => {
        const group = GROUPS[g], need = NEEDS[g], fields = fieldsOf(g);
        const ready = need.keys.every((k) => all[k]);
        const tested = q.test === g;
        return (
          <Card key={g} id={g} className="scroll-mt-28">
            <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
              {ready ? <CircleCheck className="size-6 shrink-0 text-success" /> : <CircleAlert className="size-6 shrink-0 text-gold" />}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg">{group.title} {q.saved === g ? <span role="status" className="ml-2 text-sm font-semibold text-success">Αποθηκεύτηκε</span> : null}</h2>
                <p className="text-sm text-muted-foreground">{ready ? group.hint : `Δεν έχει ρυθμιστεί. ${need.missing}`}</p>
              </div>
              {need.test ? <form action={testConnection.bind(null, g)}><Submit className={btn("outline")}>{need.test}</Submit></form> : null}
              <Modal label="Αλλαγή" title={group.title} description={group.hint}>
                <form key={fields.map(([k, d]) => ("secret" in d ? !!all[k] : all[k])).join()} action={saveConnection.bind(null, g)} className="grid gap-4 [&>button]:justify-self-end">
                  {g === "openrouter" && openRouter.failed.length ? <p role="alert" className="rounded-lg bg-gold/10 px-3 py-2 text-sm text-gold-ink">Δεν φορτώθηκε η λίστα μοντέλων {openRouter.failed.join(" και ")}. Συμπλήρωσε το αντίστοιχο ID χειροκίνητα ή ξαναδοκίμασε σε λίγο.</p> : null}
                  {fields.map(([k, d]) => {
                    const loaded = k === "OPENROUTER_CHAT_MODEL" ? openRouter.chat : k === "OPENROUTER_EMBED_MODEL" ? openRouter.embed : undefined;
                    const options = loaded ? keepCurrent(loaded, all[k]) : d.options;
                    return options?.length ? <Select key={k} label={d.label} name={k} defaultValue={all[k] || options[0][0]} options={options} hint={d.hint} />
                    // τα μυστικά δεν γεμίζουν ποτέ τη φόρμα: κενό σημαίνει «μένει όπως είναι»
                    : d.secret ? <Field key={k} label={d.label} name={k} type="password" autoComplete="off" maxLength={400} placeholder={all[k] ? "Ορισμένο · άφησέ το κενό για να μείνει το ίδιο" : ""} hint={`${d.hint ? `${d.hint}. ` : ""}Αποθηκεύεται και δεν εμφανίζεται ξανά στην οθόνη`} />
                    : <Field key={k} label={d.label} name={k} maxLength={400} defaultValue={all[k]} placeholder={d.placeholder} hint={d.hint} />;
                  })}
                  <Submit className={btn("default")}>Αποθήκευση</Submit>
                </form>
              </Modal>
            </div>
            {tested ? <p role={q.ok === "1" ? "status" : "alert"} className={`mx-5 mt-4 rounded-lg px-4 py-3 text-sm font-medium ${q.ok === "1" ? "bg-success/10 text-success-ink" : "bg-destructive/10 text-destructive"}`}>{String(q.msg ?? "").slice(0, 240)}</p> : null}
            <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map(([k, d]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{d.label}</dt>
                  <dd className="truncate font-semibold">
                    {d.secret ? <Badge tone={all[k] ? "success" : "warning"}>{all[k] ? "Ορισμένο" : "Δεν έχει οριστεί"}</Badge>
                      : k === "OPENROUTER_CHAT_MODEL" && all[k] === AUTO_MODEL ? "Αυτόματη · χαμηλότερο κόστος"
                      : d.options ? (d.options.find(([v]) => v === all[k]) ?? d.options[0])[1]
                      : all[k] || <span className="font-normal text-muted-foreground">Δεν έχει οριστεί</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        );
      })}
    </>
  );
}
