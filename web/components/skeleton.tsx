// Προφορτωτές: το σχήμα της οθόνης που έρχεται, όσο ο server διαβάζει τη βάση. Ένας ανά είδος οθόνης,
// ώστε η σελίδα να μην «πηδά» όταν φτάσουν τα δεδομένα. Χρησιμοποιούνται από τα loading.tsx κάθε διαδρομής.
import { cn } from "./ui";

export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn("animate-pulse rounded-md bg-foreground/8 motion-reduce:animate-none", className)} />;
const Box = ({ className, children }: { className?: string; children?: React.ReactNode }) => <div className={cn("rounded-xl border border-border bg-card", className)}>{children}</div>;
const Lines = ({ n, className }: { n: number; className?: string }) => (
  <div className={className}>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex items-center gap-4 border-t border-border px-5 py-3.5">
        <Skeleton className="h-3.5 w-28" /><Skeleton className="h-3.5 flex-1" /><Skeleton className="h-3.5 w-16" />
      </div>
    ))}
  </div>
);

export function PageSkeleton({ kind, title }: { kind: "dashboard" | "table" | "detail" | "pos"; title: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={`Φόρτωση: ${title}`}>
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3 max-lg:pl-16 lg:px-8">
        <div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-32" /><p className="text-xl leading-tight font-semibold text-muted-foreground lg:text-2xl">{title}</p></div>
        <Skeleton className="h-9 w-32 max-sm:hidden" />
      </header>
      <div className="max-w-[90rem] space-y-4 px-4 pt-6 lg:px-8">
        {kind === "dashboard" ? (
          <>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Box key={i} className="space-y-3 px-5 py-4"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-8 w-32" /><Skeleton className="h-3 w-40 max-w-full" /></Box>)}</div>
            <div className="grid gap-4 lg:grid-cols-[1.75fr_1fr]"><Box className="p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-5 h-64 w-full" /></Box><Box><div className="p-5"><Skeleton className="h-4 w-32" /></div><Lines n={4} /></Box></div>
          </>
        ) : kind === "table" ? (
          <Box><div className="flex gap-2 px-3 py-2"><Skeleton className="h-9 w-64 max-w-full" /><Skeleton className="h-9 w-28 max-sm:hidden" /></div><Lines n={8} /></Box>
        ) : kind === "pos" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
            <div className="space-y-3"><div className="flex gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-24" />)}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div></div>
            <Box><div className="p-5"><Skeleton className="h-4 w-36" /></div><Lines n={3} /><div className="p-5"><Skeleton className="h-12 w-full" /></div></Box>
          </div>
        ) : (
          [0, 1, 2].map((i) => <Box key={i}><div className="space-y-2 p-5"><Skeleton className="h-4 w-44" /><Skeleton className="h-3 w-72 max-w-full" /></div><Lines n={i === 0 ? 2 : 3} /></Box>)
        )}
      </div>
    </div>
  );
}
