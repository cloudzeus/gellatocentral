import { parseBody } from "@/lib/support/kb";

/** Το κείμενο ενός άρθρου. Ό,τι γράφτηκε μένει κείμενο: τίποτα δεν εκτελείται ως HTML. */
export function KbBody({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-base leading-relaxed">
      {parseBody(body).map((b, i) =>
        "text" in b ? (b.kind === "h" ? <h3 key={i} className="pt-2 text-lg font-semibold">{b.text}</h3> : <p key={i}>{b.text}</p>)
        : b.kind === "ul" ? <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
        : <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>,
      )}
    </div>
  );
}
