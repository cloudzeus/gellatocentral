"use client";
import { useEffect } from "react";
import { busy, pokeTasks } from "./feedback-events";

/** Όσο το `pending` ισχύει, η γραμμή φόρτωσης στην κορυφή φαίνεται· στην αρχή και στο τέλος ρωτάμε και για εργασίες. */
export function useBusy(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    busy(1);
    // η εργασία γράφεται στη βάση λίγο μετά την υποβολή: το παράθυρο τη βρίσκει χωρίς να περιμένει το τέλος της
    const timer = setTimeout(pokeTasks, 700);
    return () => { clearTimeout(timer); busy(-1); pokeTasks(); };
  }, [pending]);
}
