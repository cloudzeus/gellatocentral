"use client";

import { useState, useTransition } from "react";
import { Link2 } from "lucide-react";
import { issueVitrineLink } from "@/app/(app)/vitrine/actions";
import { btn } from "./ui";
import { useBusy } from "@/lib/use-busy";

export function VitrineTokenForm({ storeId }: { storeId: string }) {
  const [result, setResult] = useState<{ token: string | null; error: string | null } | null>(null);
  const [pending, start] = useTransition();
  useBusy(pending);
  return <div className="grid gap-2"><button type="button" className={btn("outline", "sm")} disabled={pending} onClick={() => start(async () => setResult(await issueVitrineLink(storeId)))}><Link2 />{pending ? "Αντικατάσταση…" : "Νέος σύνδεσμος / QR"}</button>{result?.error ? <p role="alert" className="text-xs text-destructive">{result.error}</p> : null}{result?.token ? <div role="status" className="grid gap-2 rounded-lg bg-success/10 p-3 text-xs"><span>Ο σύνδεσμος εμφανίζεται μόνο τώρα. Ο προηγούμενος ακυρώθηκε· στη βάση αποθηκεύεται μόνο hash.</span><input aria-label="Δημόσιος σύνδεσμος βιτρίνας" readOnly onFocus={(event) => event.currentTarget.select()} className="h-9 rounded border border-input bg-card px-2 font-mono" value={`${window.location.origin}/vitrine/${result.token}`} /><a className={btn("outline", "sm")} href={`/vitrine/${result.token}/qr`} target="_blank">Άνοιγμα QR για εκτύπωση</a></div> : null}</div>;
}
