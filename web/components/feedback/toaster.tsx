"use client";
// Σύντομα μηνύματα (toasts): το πολύ 3 μαζί. Η επιτυχία φεύγει μόνη της σε 4 δευτ. (παύση όσο ο δείκτης ή η εστίαση
// είναι πάνω της)· η αποτυχία μένει μέχρι να την κλείσει ο χρήστης. Δεν παίρνουν ποτέ την εστίαση.
import { Check, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { onToast, type ToastInput } from "@/lib/feedback-events";
import { btn, cn } from "../ui";

type Item = ToastInput & { key: number };
const MAX = 3;
const SUCCESS_MS = 4000;

function ToastCard({ item, close }: { item: Item; close: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(SUCCESS_MS);
  const success = item.kind === "success";
  useEffect(() => {
    if (!success || paused) return;
    const started = Date.now();
    const timer = setTimeout(close, left.current);
    // στην παύση κρατάμε όσο χρόνο απέμενε, για να μη χαθεί το μήνυμα μόλις φύγει ο δείκτης
    return () => { clearTimeout(timer); left.current = Math.max(1000, left.current - (Date.now() - started)); };
  }, [success, paused, close]);
  const Icon = success ? Check : TriangleAlert;
  return (
    <div
      role={success ? "status" : "alert"}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-[22.5rem] max-w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-[var(--shadow-pop)] animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none max-sm:w-full"
    >
      <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg", success ? "bg-success/12 text-success-ink" : "bg-destructive/10 text-destructive")}><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="break-words text-sm font-semibold">{item.title}</p>
        {item.detail || item.href ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.detail}{item.detail && item.href ? " " : null}
            {item.href ? <Link href={item.href} onClick={close} className="font-semibold text-foreground underline underline-offset-2">{item.linkText ?? "Δες το"}</Link> : null}
          </p>
        ) : null}
      </div>
      {success
        ? <button type="button" onClick={close} aria-label="Κλείσιμο μηνύματος" className={btn("ghost", "sm", "size-8 shrink-0 px-0 pointer-coarse:size-11")}><X /></button>
        : <button type="button" onClick={close} className={btn("outline", "sm", "min-h-11 min-w-11 shrink-0")}>Κλείσιμο</button>}
    </div>
  );
}

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(0);
  useEffect(() => onToast((input) => setItems((current) => {
    const all = [...current, { ...input, key: next.current++ }];
    // πάνω από 3: φεύγει πρώτα η παλαιότερη επιτυχία· μια αποτυχία που δεν έκλεισε ο χρήστης μένει όσο γίνεται
    while (all.length > MAX) all.splice(Math.max(0, all.findIndex((i) => i.kind === "success")), 1);
    return all;
  })), []);
  return items.map((item) => <ToastCard key={item.key} item={item} close={() => setItems((current) => current.filter((i) => i.key !== item.key))} />);
}
