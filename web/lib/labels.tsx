import { StatusBadge } from "@/components/status-badge";
import type { FiscalStatus } from "@/lib/generated/prisma/client";

export const FiscalBadge = ({ status }: { status: FiscalStatus }) => <StatusBadge kind="fiscal" value={status} />;
export const dateTime = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
