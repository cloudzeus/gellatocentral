"use client";
// Τα πεδία της δαπάνης που αλλάζουν ζωντανά: τύπος εξόδου + παραστατικό → «Θα δηλωθεί ως», μοιρασιά περιόδου
// στους μήνες, ειδοποίηση έγκρισης και ανέβασμα του παραστατικού. Ο server ξαναελέγχει τα ίδια στο createExpense.
import { Check, Clock, Info, LoaderCircle, Paperclip, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Field, Select } from "@/components/ui";
import { allowedTypes, CATEGORY_LABEL, DOC_TYPES, e3Text, needsApproval, splitByMonth, VAT_LABEL } from "@/lib/expense-rules";
import { euro } from "@/lib/money";

export type ExpenseTypeOption = { id: string; code: string; name: string; category: string | null; type: string | null; vat: string | null; account: string | null; center: string | null };
const DOCS: [string, string][] = [["1.1", "1.1 · Τιμολόγιο πώλησης"], ["2.1", "2.1 · Τιμολόγιο παροχής υπηρεσιών"], ["13.1", "13.1 · Αγορές λιανικής"], ["13.2", "13.2 · Παροχή λιανικής"], ["14.30", "14.30 · Λογαριασμός χωρίς MARK (ρεύμα, νερό)"], ["16.1", "16.1 · Ενοίκια"], ["14.3", "14.3 · Υπηρεσίες από ΕΕ"], ["14.4", "14.4 · Υπηρεσίες από τρίτες χώρες"], ["", "Χωρίς παραστατικό (ανεπίσημο)"]];
const fits = (t: ExpenseTypeOption, doc: string) => !!t.category && !!t.type && allowedTypes(doc, t.category).includes(t.type);
const toCents = (v: string) => Math.round(Number(v.replace(",", ".")) * 100) || 0;
const monthName = new Intl.DateTimeFormat("el-GR", { month: "short", year: "numeric", timeZone: "UTC" });

export function ExpenseFields({ types, limitCents }: { types: ExpenseTypeOption[]; limitCents: number | null }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [doc, setDoc] = useState("1.1");
  const [net, setNet] = useState("");
  const [vat, setVat] = useState("24");
  const [period, setPeriod] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [file, setFile] = useState<{ id?: string; name: string; state: "up" | "ok" | "err"; error?: string } | null>(null);
  const t = types.find((x) => x.id === typeId);
  const informal = doc === "";
  const ok = !t || informal || !t.category || !t.type || fits(t, doc);
  const others = t && !ok ? types.filter((x) => x.id !== t.id && fits(x, doc)).slice(0, 3) : [];
  const netCents = toCents(net);
  const total = netCents + Math.round(netCents * Number(vat) / 100);
  let months: { month: string; cents: number }[] = [];
  let periodError = "";
  if (period && from && to) try { months = splitByMonth(total, new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)); } catch (e) { periodError = (e as Error).message; }
  const max = Math.max(1, ...months.map((m) => m.cents));

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setFile({ name: picked.name, state: "up" });
    const body = new FormData();
    body.set("file", picked); body.set("category", "expense_document");
    try {
      const res = await fetch("/api/files", { method: "POST", body });
      const data = await res.json();
      setFile(res.ok ? { id: data.id, name: picked.name, state: "ok" } : { name: picked.name, state: "err", error: data.error ?? "Το ανέβασμα απέτυχε" });
    } catch { setFile({ name: picked.name, state: "err", error: "Δεν υπάρχει σύνδεση· δοκίμασε ξανά" }); }
  };

  return (
    <>
      <Select label="Τύπος εξόδου" name="categoryId" required value={typeId} onValueChange={setTypeId} options={types.map((x): [string, string] => [x.id, `${x.code} · ${x.name}`])} hint="Οι τύποι αλλάζουν στα Οικονομικά → Τύποι εξόδων" />
      <Select label="Παραστατικό προμηθευτή" name="mydataDocType" value={doc} onValueChange={setDoc} options={DOCS} hint="Όπως γράφει πάνω το παραστατικό" />
      <input type="hidden" name="informal" value={informal ? "on" : ""} />
      <Field label="Καθαρή αξία €" name="netAmount" inputMode="decimal" required value={net} onChange={(e) => setNet(e.target.value)} />
      <Select label="ΦΠΑ" name="vatRate" value={vat} onValueChange={setVat} options={[["24", "24%"], ["13", "13%"], ["6", "6%"], ["0", "0%"]]} />
      <div aria-live="polite" className={`flex gap-2.5 rounded-lg p-3 text-sm sm:col-span-2 ${ok ? "bg-primary/6 text-muted-foreground" : "bg-destructive/10 text-destructive"}`}>
        {informal ? <><Info className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Ανεπίσημη δαπάνη: μετρά στο αποτέλεσμα, αλλά δεν δηλώνεται στο myDATA και δεν πάει στον λογιστή.</span></>
          : !t ? <><Info className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Διάλεξε τύπο εξόδου.</span></>
          : ok ? <><Check className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Θα δηλωθεί ως: <b className="font-semibold text-foreground">{e3Text(t.type)}</b>{t.category ? ` · ${CATEGORY_LABEL[t.category] ?? t.category}` : ""}{t.vat && Number(vat) > 0 ? ` · ΦΠΑ: ${VAT_LABEL[t.vat] ?? t.vat}` : ""}. Λογαριασμός {t.account ?? "— (τον βάζει ο λογιστής)"} · κέντρο: {t.center ?? "του καταστήματος"}.</span></>
          : <><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><span><b className="font-semibold">Το «{t.name}» ({t.type}) δεν επιτρέπεται σε {DOC_TYPES[doc] ?? "παραστατικό"} {doc}.</b> {others.length ? `Ταιριάζουν: ${others.map((x) => x.name).join(", ")}.` : "Κανένας τύπος εξόδου δεν ταιριάζει σε αυτό το παραστατικό· έλεγξε τον τύπο του παραστατικού."}</span></>}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={period} onChange={(e) => setPeriod(e.target.checked)} /> Αφορά περίοδο (π.χ. ασφάλιστρο τριμήνου) · μοιράζεται στους μήνες ανά ημέρα</label>
      {period ? (
        <div className="grid gap-3 sm:col-span-2">
          <div className="grid grid-cols-2 gap-3"><Field label="Από" name="periodFrom" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /><Field label="Έως" name="periodTo" type="date" required value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {periodError ? <p role="alert" className="text-sm text-destructive">{periodError}</p> : null}
          {months.length && total ? (
            <div className="grid gap-2" aria-label="Μοιρασιά ανά μήνα">
              {months.map((m) => (
                <div key={m.month} className="grid grid-cols-[5.5rem_minmax(0,1fr)_6rem] items-center gap-3 text-sm">
                  <span className="first-letter:uppercase">{monthName.format(new Date(`${m.month}-01T00:00:00Z`))}</span>
                  <span className="h-5 overflow-hidden rounded-md bg-primary/5"><span className="block h-full rounded-md bg-primary transition-[width] duration-300" style={{ width: `${(m.cents / max) * 100}%` }} /></span>
                  <span className="text-right font-semibold tabular-nums">{euro(m.cents)}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Στο αποτέλεσμα κάθε μήνα μετρά μόνο το μερίδιό του. Το άθροισμα είναι ακριβώς {euro(total)}.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <Field label="Πληρώνεται έως" name="dueAt" type="date" hint="Θα φανεί στα «Λήγουν σε 7 ημέρες»" />
      <div className="grid gap-1">
        <span className="text-sm font-medium">Παραστατικό (PDF ή φωτογραφία)</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
          {file?.state === "up" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
          <span className="min-w-0 truncate">{file ? file.name : "Διάλεξε αρχείο"}</span>
          <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {file?.state === "err" ? <span role="alert" className="text-xs text-destructive">{file.error}</span> : file?.state === "ok" ? <span className="text-xs text-success-ink">Ανέβηκε</span> : null}
        <input type="hidden" name="fileId" value={file?.id ?? ""} />
      </div>
      {needsApproval(total, limitCents) ? (
        <p className="flex gap-2.5 rounded-lg bg-warning/20 p-3 text-sm text-warning-ink sm:col-span-2"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden />Σύνολο {euro(total)}, πάνω από το όριο των {euro(limitCents!)}: θα περιμένει έγκριση. Άφησε κενό τον λογαριασμό πληρωμής· η πληρωμή καταχωρίζεται μετά την έγκριση.</p>
      ) : null}
    </>
  );
}
