import { Badge } from "@/components/ui";
import type { FiscalStatus } from "@/lib/generated/prisma/client";

const FISCAL: Record<FiscalStatus, { tone: "neutral" | "success" | "warning" | "danger"; text: string }> = {
  SIGNED: { tone: "success", text: "Διαβιβάστηκε στην ΑΑΔΕ" },
  PENDING: { tone: "warning", text: "Σε εξέλιξη" },
  NOT_SENT: { tone: "warning", text: "Δοκιμαστική — δεν διαβιβάστηκε" },
  FAILED: { tone: "danger", text: "Απέτυχε — θέλει ενέργεια" },
};
export const FiscalBadge = ({ status }: { status: FiscalStatus }) => <Badge tone={FISCAL[status].tone}>{FISCAL[status].text}</Badge>;
export const METHOD = { CASH: "Μετρητά", CARD: "Κάρτα" } as const;
export const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
