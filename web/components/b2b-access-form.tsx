"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { issueB2bAccess } from "@/app/(app)/wholesale-orders/actions";
import { btn, Field } from "./ui";
import { useBusy } from "@/lib/use-busy";

export function B2bAccessForm({ customerId }: { customerId: string }) {
  const [expiresAt, setExpiresAt] = useState("");
  const [result, setResult] = useState<{ token: string | null; error: string | null } | null>(null);
  const [pending, start] = useTransition();
  useBusy(pending);
  return <div className="grid gap-3 rounded-lg border border-border/70 p-3">
    <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
      <Field label="Λήξη συνδέσμου (προαιρετικά)" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      <button type="button" disabled={pending} className={btn("outline")} onClick={() => start(async () => setResult(await issueB2bAccess(customerId, expiresAt || null)))}><KeyRound />{pending ? "Δημιουργία…" : "Νέος σύνδεσμος"}</button>
    </div>
    {result?.error ? <p role="alert" className="text-sm text-destructive">{result.error}</p> : null}
    {result?.token ? <div role="status" className="grid gap-2 rounded-lg bg-success/10 p-3 text-sm"><p className="font-medium text-success-ink">Ο σύνδεσμος εμφανίζεται μόνο τώρα. Η αντικατάσταση ακυρώνει τον προηγούμενο.</p><input aria-label="Σύνδεσμος B2B" readOnly onFocus={(event) => event.currentTarget.select()} className="h-9 rounded-lg border border-input bg-card px-2 font-mono text-xs" value={`${window.location.origin}/b2b/${result.token}`} /></div> : null}
  </div>;
}
