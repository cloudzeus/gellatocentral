"use client";
// Λεπτή γραμμή στην κορυφή του παραθύρου όσο μια πλοήγηση ή μια ενέργεια στον server κρατά πάνω από ~150ms.
// Αόριστη (δεν ξέρουμε πόσο θα πάρει)· με reduced motion γίνεται σταθερή μπάρα (βλ. .process-indicator).
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BUSY_EVENT, NAV_EVENT } from "@/lib/feedback-events";

export function TopProgress() {
  const here = `${usePathname()}?${useSearchParams()}`;
  // από ποια διεύθυνση ξεκίνησε η πλοήγηση: μόλις αλλάξει η διεύθυνση, η πλοήγηση τελείωσε (χωρίς effect)
  const [navFrom, setNavFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  useEffect(() => {
    let failsafe: ReturnType<typeof setTimeout> | undefined;
    const nav = (e: Event) => {
      const target = new URL((e as CustomEvent<string>).detail, window.location.href);
      const current = `${window.location.pathname}?${new URLSearchParams(window.location.search)}`;
      // ίδια διεύθυνση: δεν θα δούμε ποτέ «άλλαξε», άρα δεν ανάβουμε γραμμή που δεν θα έσβηνε
      if (`${target.pathname}?${target.searchParams}` === current) return;
      // το Next στέλνει το σήμα μέσα στο δικό του transition: ένα setState εδώ θα περίμενε να ΤΕΛΕΙΩΣΕΙ η πλοήγηση.
      // Με setTimeout βγαίνουμε από το transition και η γραμμή φαίνεται όσο η πλοήγηση τρέχει.
      setTimeout(() => setNavFrom(current), 0);
      clearTimeout(failsafe);
      failsafe = setTimeout(() => setNavFrom(null), 20_000);
    };
    const count = (e: Event) => setBusy((n) => Math.max(0, n + (e as CustomEvent<number>).detail));
    window.addEventListener(NAV_EVENT, nav);
    window.addEventListener(BUSY_EVENT, count);
    return () => { clearTimeout(failsafe); window.removeEventListener(NAV_EVENT, nav); window.removeEventListener(BUSY_EVENT, count); };
  }, []);
  if (!(navFrom === here || busy > 0)) return null;
  return (
    <div aria-hidden className="top-progress pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.75 overflow-hidden print:hidden">
      <span className="process-indicator absolute inset-y-0 w-1/3 bg-gold" />
    </div>
  );
}
