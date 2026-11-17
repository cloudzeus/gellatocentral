import Image from "next/image";
import type { ReactNode } from "react";
import { Card } from "./ui";

/** Κοινό πλαίσιο για σύνδεση, «ξέχασα τον κωδικό» και ορισμό κωδικού. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm overflow-hidden">
        <div className="sidebar-surface flex justify-center px-6 py-6">
          <Image src="/logo.png" alt="Gelato System" width={220} height={96} priority className="h-20 w-auto" />
        </div>
        <div className="space-y-4 p-6">{children}</div>
      </Card>
    </main>
  );
}
export const Notice = ({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) => (
  <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm font-semibold ${tone === "error" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>{children}</p>
);
