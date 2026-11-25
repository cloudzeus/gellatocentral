"use client";
// «Συμπλήρωση από ΑΦΜ» σε απλή φόρμα: διαβάζει το πεδίο vatNumber, ρωτά το /api/vat-lookup (μητρώο ΑΑΔΕ/VIES)
// και γεμίζει μόνο όσα πεδία έφερε· ό,τι έγραψε ήδη ο χρήστης σε άλλα πεδία μένει.
import { LoaderCircle, Search } from "lucide-react";
import { useRef, useState } from "react";
import { btn } from "@/components/ui";

type Lookup = { ok: boolean; message: string | null; source: string | null; fields: Record<string, string | undefined> };

export function VatFillButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function fill() {
    const form = ref.current?.form;
    const vat = (form?.elements.namedItem("vatNumber") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!form || !vat) return setNote({ ok: false, text: "Γράψε πρώτα τον ΑΦΜ" });
    setBusy(true);
    const r: Lookup = await fetch(`/api/vat-lookup?country=GR&vat=${encodeURIComponent(vat)}`).then((x) => x.json())
      .catch(() => ({ ok: false, message: "Η αναζήτηση δεν ολοκληρώθηκε. Συμπλήρωσε με το χέρι", source: null, fields: {} }));
    setBusy(false);
    let filled = 0;
    for (const [k, v] of Object.entries(r.fields ?? {})) {
      const input = form.elements.namedItem(k);
      if (input instanceof HTMLInputElement && v) { input.value = v; filled++; }
    }
    setNote({ ok: r.ok && filled > 0, text: r.message ?? (filled ? `Συμπληρώθηκαν ${filled} πεδία από ${r.source ?? "το μητρώο"}. Έλεγξέ τα πριν την αποθήκευση` : "Δεν βρέθηκαν στοιχεία. Συμπλήρωσε με το χέρι") });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button ref={ref} type="button" onClick={fill} disabled={busy} className={btn("outline", "default")}>
        {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Search aria-hidden />}Συμπλήρωση από ΑΦΜ
      </button>
      <p aria-live="polite" className={note?.ok ? "text-xs text-success-ink" : "text-xs text-muted-foreground"}>{note?.text}</p>
    </div>
  );
}
