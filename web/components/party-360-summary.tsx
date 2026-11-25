import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { Party360Metric } from "@/lib/party-360";
import { euro } from "@/lib/money";
import { Card } from "@/components/ui";

/** Συνοπτική 360 εικόνα μόνο από τις ενότητες που επιτρέπει ο ρόλος και το store/warehouse scope. */
export function Party360Summary({ metrics, restricted }: { metrics: Party360Metric[]; restricted: boolean }) {
  if (!metrics.length) return null;
  return (
    <section aria-labelledby="party-360-title">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
        <div><h2 id="party-360-title" className="font-semibold">Εμπορική εικόνα 360°</h2><p className="text-xs text-muted-foreground">Πραγματικές παραγγελίες, παραστατικά και πληρωμές{restricted ? " · μόνο στο επιτρεπόμενο store/warehouse scope" : ""}</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.id} className="p-4">
            <Link href={metric.href} className="group flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="mt-1.5 text-xl font-semibold tabular-nums">{euro(metric.totalCents)}</p><p className="mt-1 text-xs text-muted-foreground">{metric.count} {metric.count === 1 ? "εγγραφή" : "εγγραφές"}</p></div>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}
