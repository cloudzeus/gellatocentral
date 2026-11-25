"use client";
// Κεντρική ανάγνωση των μηνυμάτων μετά από ενέργεια: ?saved= / ?error= από το redirect, ή το cookie gs.flash.
// Δείχνει toast και καθαρίζει το param από τη διεύθυνση (χωρίς νέο αίτημα στον server, ώστε το μήνυμα λάθους
// δίπλα στη φόρμα να μένει στη θέση του).
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "@/lib/feedback-events";
import { FLASH_COOKIE, flashFromUrl, withoutFlash, type FlashCookie } from "@/lib/flash";

const shown = new Set<string>();

export function FlashToasts({ cookie }: { cookie: FlashCookie | null }) {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    // από το window, όχι από το hook: στο δεύτερο τρέξιμο του effect (StrictMode) η διεύθυνση είναι ήδη καθαρή
    const flash = flashFromUrl(window.location.pathname, new URLSearchParams(window.location.search));
    if (!flash) return;
    toast(flash);
    window.history.replaceState(null, "", withoutFlash(window.location.pathname, window.location.search, window.location.hash));
  }, [pathname, search]);
  useEffect(() => {
    if (!cookie || shown.has(cookie.id)) return;
    shown.add(cookie.id);
    toast(cookie);
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
  }, [cookie]);
  return null;
}
