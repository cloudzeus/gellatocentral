"use client";

import { useState, useTransition } from "react";
import { Copy, Mail, MessageSquare, UserPlus } from "lucide-react";
import { issueEmployeeInvite } from "@/app/(app)/staff/actions";
import { btn } from "./ui";
import { useBusy } from "@/lib/use-busy";

type Result = Awaited<ReturnType<typeof issueEmployeeInvite>>;

/** Δημιουργεί link εγγραφής στο portal και δίνει τρόπους να φτάσει στον εργαζόμενο (αντιγραφή, email, SMS από τη συσκευή). */
export function EmployeeInviteForm({ employeeId, sent }: { employeeId: string; sent?: string | null }) {
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  useBusy(pending);
  const url = result?.token ? `${window.location.origin}/join/${result.token}` : "";
  const text = result?.token ? `Γεια σου ${result.name}. Φτιάξε τον λογαριασμό σου για να βλέπεις το πρόγραμμά σου: ${url}` : "";
  const until = result?.expiresAt ? new Date(result.expiresAt).toLocaleDateString("el-GR") : "";
  return <div className="grid gap-2">
    <button type="button" className={btn("outline", "sm")} disabled={pending} onClick={() => start(async () => { setCopied(false); setResult(await issueEmployeeInvite(employeeId)); })}>
      <UserPlus />{pending ? "Δημιουργία…" : sent ? "Νέο link εγγραφής" : "Link εγγραφής στο portal"}
    </button>
    {sent && !result ? <p className="text-xs text-muted-foreground">Τελευταίο link: {sent}</p> : null}
    {result?.error ? <p role="alert" className="text-xs text-destructive">{result.error}</p> : null}
    {result?.token ? <div role="status" className="grid gap-2 rounded-lg bg-success/10 p-2 text-xs">
      <span>Ισχύει έως {until}, για μία εγγραφή. Το προηγούμενο link δεν ισχύει πια.</span>
      <input aria-label="Link εγγραφής" readOnly onFocus={(e) => e.currentTarget.select()} className="h-8 rounded border border-input bg-card px-2 font-mono" value={url} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn("outline", "sm")} onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); }}><Copy />{copied ? "Αντιγράφηκε" : "Αντιγραφή"}</button>
        {result.email ? <a className={btn("outline", "sm")} href={`mailto:${result.email}?subject=${encodeURIComponent("Λογαριασμός προσωπικού")}&body=${encodeURIComponent(text)}`}><Mail />Email</a> : null}
        {result.phone ? <a className={btn("outline", "sm")} href={`sms:${result.phone.replace(/[^+\d]/g, "")}?body=${encodeURIComponent(text)}`}><MessageSquare />SMS</a> : null}
      </div>
    </div> : null}
  </div>;
}
