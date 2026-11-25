"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Download, FileSpreadsheet, FileText, Send } from "lucide-react";
import type { DocumentEntity } from "@/lib/documents/model";
import { Modal } from "./modal";
import { btn } from "./ui";

type Channel = "email" | "viber";
type Recipient = { id: string; name: string; email: string | null; viber: string | null; viberReason: string };
type RecipientsResponse = { externalSendingEnabled?: boolean; canSend?: boolean; recipients?: Recipient[]; message?: string };
type DeliveryResponse = { delivery?: { status: string; deliveryStatus: string; detail: string }; message?: string };

function DocumentDeliveryPanel({ entityType, entityId }: { entityType: DocumentEntity; entityId: string }) {
  const base = `/api/documents/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/delivery`;
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(base, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as RecipientsResponse;
        if (!response.ok) throw new Error(body.message ?? "Δεν φορτώθηκαν οι παραλήπτες");
        if (!active) return;
        const rows = body.recipients ?? [];
        setRecipients(rows);
        setEnabled(body.externalSendingEnabled === true);
        setCanSend(body.canSend === true);
        setRecipientId(rows[0]?.id ?? "");
        setChannel(rows[0]?.email ? "email" : "viber");
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Δεν φορτώθηκαν οι παραλήπτες"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base]);

  const recipient = recipients.find((row) => row.id === recipientId);
  const destination = channel === "email" ? recipient?.email : recipient?.viber;
  const send = async () => {
    setPending(true);
    setError("");
    setResult("");
    try {
      const response = await fetch(base, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ recipientId, channel, confirm }) });
      const body = await response.json() as DeliveryResponse;
      if (!response.ok || !body.delivery) throw new Error(body.message ?? "Η αποστολή απέτυχε");
      setResult(`${body.delivery.deliveryStatus}: ${body.delivery.detail}`);
      if (body.delivery.status !== "FAILED" && body.delivery.status !== "ABORTED") setConfirm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Η αποστολή απέτυχε");
    } finally {
      setPending(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Φόρτωση συσχετισμένων παραληπτών…</p>;
  return <div className="grid gap-4">
    {!enabled ? <p role="alert" className="rounded-lg bg-warning/15 p-3 text-sm text-warning-ink">Η εξωτερική αποστολή είναι απενεργοποιημένη. Ενεργοποιείται από Στοιχεία επιχείρησης και κάθε αποστολή εξακολουθεί να απαιτεί ρητή ενέργεια.</p> : null}
    {!canSend ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Δεν έχεις το απαιτούμενο δικαίωμα επεξεργασίας για εξωτερική αποστολή.</p> : null}
    {recipients.length ? <>
      <label className="grid gap-1 text-sm"><span className="font-medium">Συσχετισμένος παραλήπτης</span><select className="h-10 rounded-lg border border-input bg-card px-3" value={recipientId} onChange={(event) => { const next = recipients.find((row) => row.id === event.target.value); setRecipientId(event.target.value); setChannel(next?.email ? "email" : "viber"); setResult(""); }}>{recipients.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm"><span className="font-medium">Κανάλι</span><select className="h-10 rounded-lg border border-input bg-card px-3" value={channel} onChange={(event) => { setChannel(event.target.value as Channel); setResult(""); }}><option value="email" disabled={!recipient?.email}>Email {recipient?.email ? `(${recipient.email})` : "(δεν υπάρχει)"}</option><option value="viber" disabled={!recipient?.viber}>Viber text ειδοποίηση {recipient?.viber ? `(${recipient.viber})` : "(μη διαθέσιμο)"}</option></select></label>
      {channel === "viber" ? <p className="text-xs text-muted-foreground">Το επίσημο Bot API δέχεται μόνο subscriber ID, όχι τηλέφωνο. {recipient?.viberReason} Το ιδιωτικό PDF δεν γίνεται δημόσιο· αποστέλλεται μόνο text ειδοποίηση.</p> : <p className="text-xs text-muted-foreground">{entityType === "schedule_publication" ? "Το email περιέχει ICS μόνο με τις βάρδιες του επιλεγμένου εργαζομένου, όχι το πρόγραμμα των συναδέλφων." : "Δημιουργείται πραγματικό PDF, αποθηκεύεται ιδιωτικά και επισυνάπτεται μέσω Mailgun."}</p>}
      <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm"><input type="checkbox" className="mt-1" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /><span>Επιβεβαιώνω την πραγματική εξωτερική αποστολή στον επιλεγμένο παραλήπτη. Μετά από SENT ή ασαφή απάντηση δεν θα γίνει αυτόματη επανάληψη.</span></label>
      <button type="button" className={btn("default", "default", "justify-self-start")} disabled={pending || !enabled || !canSend || !recipient || !destination || !confirm} onClick={send}><Send /> {pending ? "Αποστολή σε εξέλιξη…" : "Πραγματική αποστολή"}</button>
    </> : <p className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Δεν υπάρχει ενεργός, συσχετισμένος παραλήπτης για αυτό το έγγραφο. Δεν επιτρέπεται ελεύθερη διεύθυνση ή παραλήπτης άλλου tenant.</p>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {result ? <p role="status" className="rounded-lg bg-secondary p-3 text-sm">{result}</p> : null}
  </div>;
}

export function DocumentPdfButton({ entityType, entityId }: { entityType: DocumentEntity; entityId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, { method: "POST", headers: { Accept: "application/json" } });
      const body = await response.json() as { file?: { url?: string }; message?: string };
      if (!response.ok || !body.file?.url) throw new Error(body.message ?? "Η δημιουργία PDF απέτυχε");
      window.location.assign(body.file.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Η δημιουργία PDF απέτυχε");
    } finally {
      setPending(false);
    }
  };
  return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" className={btn("outline")} disabled={pending} onClick={create}><Download /> {pending ? "Δημιουργία PDF…" : "Λήψη PDF"}</button><Modal label={<><Send /> Αποστολή</>} title="Εξωτερική αποστολή εγγράφου" description="Ξεχωριστή, ρητή ενέργεια από τη λήψη PDF· πραγματικό αποτέλεσμα provider και ασφαλές replay."><DocumentDeliveryPanel entityType={entityType} entityId={entityId} /></Modal>{error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}</span>;
}

export function ScheduleExportLinks({ publicationId }: { publicationId: string }) {
  const base = `/api/documents/schedule_publication/${encodeURIComponent(publicationId)}`;
  return <span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="schedule_publication" entityId={publicationId} /><a href={`${base}?format=xlsx`} className={btn("outline", "sm")}><FileSpreadsheet /> XLSX</a><a href={`${base}?format=csv`} className={btn("outline", "sm")}><FileText /> CSV</a><a href={`${base}?format=ics`} className={btn("outline", "sm")}><CalendarDays /> ICS</a></span>;
}
