"use client";
import { useSyncExternalStore } from "react";

const STORE_EVENT = "gs-store";
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // χωρίς αποθήκευση (ιδιωτική περιήγηση): απλώς δεν θυμάται
  }
};

/** Τιμή που θυμάται ο browser. Στον server (και στο πρώτο render) ισχύει η αρχική, ώστε να ταιριάζουν. */
export function useStored<T>(key: string, initial: T) {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value: T = raw ? JSON.parse(raw) : initial;
  const set = (next: T) => {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event(STORE_EVENT));
  };
  return [value, set] as const;
}
