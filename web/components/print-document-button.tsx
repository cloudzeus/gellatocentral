"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { btn } from "./ui";
import { recordBrowserPrint } from "@/app/(app)/print/actions";

export function PrintDocumentButton({ entityType, entityId }: { entityType: "production_batch" | "recipe"; entityId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return <div className="print:hidden"><button type="button" className={btn("default")} disabled={pending} onClick={() => start(async () => {
    setError("");
    try { await recordBrowserPrint(entityType, entityId); window.print(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Η εκτύπωση δεν καταγράφηκε"); }
  })}><Printer /> {pending ? "Καταγραφή…" : "Εκτύπωση browser"}</button>{error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}</div>;
}
