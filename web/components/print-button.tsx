"use client";
import { Printer } from "lucide-react";
import { btn } from "./ui";

/** Μόνο το κάλεσμα του browser print χρειάζεται client κώδικα· το παραστατικό παραμένει RSC. */
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={btn("outline")}><Printer /> Εκτύπωση</button>;
}
