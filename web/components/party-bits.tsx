import { isPartyRole, PARTY_ROLES } from "@/lib/parties";
import { Badge } from "./ui";

const ROLE_TONE = { customer: "success", supplier: "warning", franchisee: "neutral", partner: "neutral" } as const;
/** Οι ρόλοι ενός συναλλασσόμενου ως ετικέτες (μπορεί να έχει πολλούς). */
export const RoleBadges = ({ roles }: { roles: string[] }) => <span className="flex flex-wrap gap-1">{roles.filter(isPartyRole).map((r) => <Badge key={r} tone={ROLE_TONE[r]}>{PARTY_ROLES[r].label}</Badge>)}</span>;
