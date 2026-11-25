"use client";

import { useState, useTransition } from "react";
import { Link2 } from "lucide-react";
import { issueScheduleLink } from "@/app/(app)/staff/actions";
import { btn } from "./ui";
import { useBusy } from "@/lib/use-busy";

export function ScheduleLinkForm({ employeeId }: { employeeId: string }) {
  const [result, setResult] = useState<{ token: string | null; error: string | null } | null>(null);
  const [pending, start] = useTransition();
  useBusy(pending);
  return <div className="grid gap-2"><button type="button" className={btn("outline", "sm")} disabled={pending} onClick={() => start(async () => setResult(await issueScheduleLink(employeeId)))}><Link2 />{pending ? "Δημιουργία…" : "Σύνδεσμος προγράμματος"}</button>{result?.error ? <p role="alert" className="text-xs text-destructive">{result.error}</p> : null}{result?.token ? <div role="status" className="grid gap-1 rounded-lg bg-success/10 p-2 text-xs"><span>Εμφανίζεται μόνο τώρα· η αντικατάσταση ακυρώνει τον προηγούμενο σύνδεσμο.</span><input aria-label="Σύνδεσμος προγράμματος" readOnly onFocus={(event) => event.currentTarget.select()} className="h-8 rounded border border-input bg-card px-2 font-mono" value={`${window.location.origin}/schedule/${result.token}`} /></div> : null}</div>;
}
