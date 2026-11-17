import { Printer } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Card, menuItem, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateTime, FiscalBadge, METHOD } from "@/lib/labels";
import { euro } from "@/lib/money";
import { listParams } from "@/lib/paging";

export default async function ReceiptsPage({ searchParams }: PageProps<"/receipts">) {
  const { org } = await currentOrg("receipts.view");
  const list = listParams(await searchParams);
  // αναζήτηση: «A1-12», σκέτη σειρά «A1», αριθμός απόδειξης «12» ή όνομα ταμείου
  const [series, aa] = list.q.toUpperCase().split("-");
  const number = Number(aa ?? list.q);
  const where = {
    orgId: org.id,
    status: "COMPLETED" as const,
    ...(list.q
      ? aa !== undefined
        ? { series, ...(Number.isInteger(number) ? { aa: number } : {}) }
        : { OR: [{ series: { contains: series } }, { device: { name: { contains: list.q, mode: "insensitive" as const } } }, ...(Number.isInteger(number) ? [{ aa: number }] : [])] }
      : {}),
  };
  const [sales, total] = await Promise.all([
    db.sale.findMany({ where, orderBy: { issuedAt: "desc" }, skip: list.skip, take: list.take, include: { payment: true, fiscal: true, device: true } }),
    db.sale.count({ where }),
  ]);
  return (
    <Page section="Ταμείο & τιμολόγηση" title="Αποδείξεις" description="Οι αποδείξεις λιανικής που εκδόθηκαν, με την κατάσταση διαβίβασής τους">
      <Card>
        <DataTable
          id="receipts"
          listing={{ ...list, total, placeholder: "Απόδειξη (π.χ. A1-12) ή ταμείο" }}
          empty={<>Δεν έχει εκδοθεί ακόμα απόδειξη. Ξεκίνα από το <Link href="/pos" className="font-bold underline">Ταμείο</Link>.</>}
          columns={[
            { key: "no", label: "Απόδειξη", required: true },
            { key: "date", label: "Ημερομηνία" },
            { key: "device", label: "Ταμείο" },
            { key: "method", label: "Πληρωμή" },
            { key: "fiscal", label: "ΑΑΔΕ" },
            { key: "total", label: "Ποσό", numeric: true },
          ]}
          rows={sales.map((s) => ({
            id: s.id,
            cells: {
              no: <Link href={`/receipts/${s.id}`} className="font-bold underline-offset-2 hover:underline">{s.series}-{s.aa}</Link>,
              date: s.issuedAt ? dateTime.format(s.issuedAt) : "—",
              device: s.device.name,
              method: s.payment ? METHOD[s.payment.method] : "—",
              fiscal: s.fiscal ? <FiscalBadge status={s.fiscal.status} /> : "—",
              total: euro(s.totalCents),
            },
            menu: <Link href={`/receipts/${s.id}`} role="menuitem" className={menuItem}><Printer /> Προβολή και εκτύπωση</Link>,
          }))}
        />
      </Card>
    </Page>
  );
}
