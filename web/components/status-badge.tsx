// Ετικέτα κατάστασης: εικονίδιο + λέξη + χρώμα, πάντα από τον κεντρικό χάρτη του lib/status.ts.
import { Check, Clock, TriangleAlert } from "lucide-react";
import { statusOf, type StatusKind, type StatusLook } from "@/lib/status";
import { Badge } from "./ui";

const ICONS = { TriangleAlert, Clock, Check };

/** Δώσε είτε `kind` + `value` (enum της βάσης) είτε έτοιμο `look` (π.χ. από paymentStatus). */
export function StatusBadge(p: { kind: StatusKind; value: string | null | undefined } | { look: StatusLook }) {
  const s = "look" in p ? p.look : statusOf(p.kind, p.value);
  return <Badge tone={s.tone} icon={s.icon ? ICONS[s.icon] : null}>{s.text}</Badge>;
}
