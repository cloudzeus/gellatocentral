"use client";
// Το πεδίο «Τι συμβαίνει;» του νέου αιτήματος: όσο γράφει ο χρήστης, προτείνει άρθρα που ίσως το λύνουν πριν στείλει.
import { ArrowRight, BookOpen, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export function TicketSubject() {
  const [value, setValue] = useState("");
  const [found, setFound] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (value.trim().length < 4) return;
    const stop = new AbortController();
    // περιμένει να σταματήσει η πληκτρολόγηση: ένα αίτημα ανά παύση, όχι ανά γράμμα
    const timer = setTimeout(() => fetch(`/api/kb/suggest?q=${encodeURIComponent(value)}`, { signal: stop.signal }).then((r) => (r.ok ? r.json() : [])).then(setFound).catch(() => {}), 350);
    return () => { clearTimeout(timer); stop.abort(); };
  }, [value]);
  const shown = value.trim().length < 4 ? [] : found;
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm font-medium">Τι συμβαίνει;<span className="text-destructive"> *</span>
        <input name="subject" required minLength={5} maxLength={140} value={value} onChange={(e) => setValue(e.target.value)} placeholder="π.χ. Δεν τυπώνει ο εκτυπωτής" className="h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm font-normal pointer-coarse:h-11" />
      </label>
      {shown.length ? (
        <div className="space-y-1.5 rounded-lg bg-secondary p-3" aria-live="polite">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles className="size-3.5 text-gold-ink" /> Μήπως βοηθά κάτι από αυτά;</p>
          {shown.map((a) => (
            <a key={a.id} href={`/help/${a.id}`} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-background">
              <BookOpen className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1">{a.title}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
          <p className="text-xs text-muted-foreground">Ανοίγουν σε νέα καρτέλα. Αν λύθηκε, δεν χρειάζεται να στείλεις αίτημα</p>
        </div>
      ) : null}
    </div>
  );
}
