"use client";

import { useState } from "react";
import { CalendarDays, Download, FileSpreadsheet, FileText } from "lucide-react";
import type { DocumentEntity } from "@/lib/documents/model";
import { btn } from "./ui";

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
  return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" className={btn("outline")} disabled={pending} onClick={create}><Download /> {pending ? "Δημιουργία PDF…" : "Λήψη PDF"}</button>{error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}</span>;
}

export function ScheduleExportLinks({ publicationId }: { publicationId: string }) {
  const base = `/api/documents/schedule_publication/${encodeURIComponent(publicationId)}`;
  return <span className="flex flex-wrap gap-2"><DocumentPdfButton entityType="schedule_publication" entityId={publicationId} /><a href={`${base}?format=xlsx`} className={btn("outline", "sm")}><FileSpreadsheet /> XLSX</a><a href={`${base}?format=csv`} className={btn("outline", "sm")}><FileText /> CSV</a><a href={`${base}?format=ics`} className={btn("outline", "sm")}><CalendarDays /> ICS</a></span>;
}
