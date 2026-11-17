"use client";
import { useEffect } from "react";

/** Εγγραφή του service worker. Μόνο στην παραγωγή: στην ανάπτυξη η cache θα έκρυβε τις αλλαγές. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
