import { Building, CalendarPlus, Plus, Send, UserPlus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { ScheduleExportLinks } from "@/components/document-output";
import { Modal } from "@/components/modal";
import { ScheduleLinkForm } from "@/components/schedule-link-form";
import { StatusBadge } from "@/components/status-badge";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, Select, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { filterParam, listParams } from "@/lib/paging";
import { look } from "@/lib/status";
import { staffPayrollSummary } from "@/lib/staff-db";
import { requireStockContext, warehouseScopeWhere } from "@/lib/stock-context";
import { employeePay, newDepartment, newEmployee, newLeave, newShift, publishStaffSchedule } from "./actions";

const money = (value: number | null | undefined) => euro(value ?? 0);
const dateTime = (value: Date) => new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(value);
const LEAVE_KINDS: [string, string][] = [["annual", "Ετήσια"], ["sick", "Ασθένεια"], ["unpaid", "Άνευ αποδοχών"], ["other", "Άλλη"]];

// Τέσσερις πίνακες στην ίδια σελίδα: ο καθένας έχει δικά του URL keys (πρόθεμα) και κουβαλά την κατάσταση των άλλων,
// ώστε η αλλαγή σελίδας στον έναν να μην μηδενίζει τους υπόλοιπους.
type Params = Record<string, string | string[] | undefined>;
const keysOf = (p: string) => ({ q: `${p}q`, sort: `${p}sort`, dir: `${p}dir`, page: `${p}page` });
const own = (sp: Params, p: string) => ({ q: sp[`${p}q`], sort: sp[`${p}sort`], dir: sp[`${p}dir`], page: sp[`${p}page`] });
const others = (sp: Params, p: string, filters: string[] = []) => Object.fromEntries(Object.entries(sp).flatMap(([key, value]) => typeof value === "string" && !["error", "saved", ...Object.values(keysOf(p)), ...filters].includes(key) ? [[key, value]] : []));

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const ctx = await requireStockContext("staff.read");
  const query = await searchParams;
  const canPay = ctx.can("staff.pay");
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  const warehouses = await db.warehouse.findMany({ where: { ...warehouseScopeWhere(ctx), active: true }, orderBy: { name: "asc" } });
  const employeeScope = restricted ? { OR: [...(ctx.storeIds.length ? [{ storeId: { in: [...ctx.storeIds] } }] : []), { warehouseId: { in: warehouses.map((row) => row.id) } }] } : {};
  // όλοι οι εργαζόμενοι του δικαιώματος (μόνο id/όνομα): επιλογές στις φόρμες και scope για βάρδιες/άδειες
  const employees = await db.employee.findMany({ where: { orgId: ctx.orgId, ...employeeScope }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });
  const employeeIds = employees.map((employee) => employee.id);
  const [departments, stores] = await Promise.all([
    db.department.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { name: "asc" } }),
    db.store.findMany({ where: { orgId: ctx.orgId, active: true, ...(ctx.storeIds.length ? { id: { in: [...ctx.storeIds] } } : {}) }, orderBy: { name: "asc" } }),
  ]);
  const text = (q: string) => ({ contains: q, mode: "insensitive" as const });

  const eList = listParams(own(query, "e"), 25, ["name"]);
  const eActive = filterParam(query, "eactive", ["yes", "no"]);
  const eWhere = {
    orgId: ctx.orgId,
    AND: [employeeScope, eList.q ? { OR: [{ name: text(eList.q) }, { email: text(eList.q) }, { phone: text(eList.q) }] } : {}],
    ...(eActive ? { active: eActive === "yes" } : {}),
  };
  const shiftSorts: ("start" | "rate")[] = canPay ? ["start", "rate"] : ["start"];
  const sList = listParams(own(query, "s"), 25, shiftSorts);
  const sWhere = {
    orgId: ctx.orgId, employeeId: { in: employeeIds },
    ...(sList.q ? { OR: [{ employee: { name: text(sList.q) } }, { note: text(sList.q) }] } : {}),
  };
  const lList = listParams(own(query, "l"), 25, ["from"]);
  const lKind = filterParam(query, "lkind", LEAVE_KINDS.map(([value]) => value));
  const lWhere = {
    orgId: ctx.orgId, employeeId: { in: employeeIds },
    ...(lKind ? { kind: lKind } : {}),
    ...(lList.q ? { OR: [{ employee: { name: text(lList.q) } }, { note: text(lList.q) }] } : {}),
  };
  const pList = listParams(own(query, "p"), 25, ["published"]);
  const pNeedle = pList.q.toLocaleLowerCase("el");
  const pWhere = {
    orgId: ctx.orgId, ...(ctx.storeIds.length ? { storeId: { in: [...ctx.storeIds] } } : {}),
    ...(pList.q ? { AND: [{ OR: [{ publishedByName: text(pList.q) }, { storeId: { in: stores.filter((store) => store.name.toLocaleLowerCase("el").includes(pNeedle)).map((store) => store.id) } }] }] } : {}),
  };
  const [staff, staffTotal, shifts, shiftTotal, leaves, leaveTotal, publications, publicationTotal] = await Promise.all([
    db.employee.findMany({ where: eWhere, include: { pay: canPay }, orderBy: [{ name: eList.sort === "name" ? eList.dir : "asc" }, { id: "asc" }], skip: eList.skip, take: eList.take }),
    db.employee.count({ where: eWhere }),
    db.shift.findMany({ where: sWhere, select: { id: true, employeeId: true, departmentId: true, storeId: true, startsAt: true, endsAt: true, breakMinutes: true, hourlyRateCents: canPay, note: true, publishedAt: true }, orderBy: sList.sort === "rate" ? [{ hourlyRateCents: sList.dir }, { id: "desc" }] : [{ startsAt: sList.sort === "start" ? sList.dir : "desc" }, { id: "desc" }], skip: sList.skip, take: sList.take }),
    db.shift.count({ where: sWhere }),
    db.employeeLeave.findMany({ where: lWhere, orderBy: [{ fromAt: lList.sort === "from" ? lList.dir : "desc" }, { id: "desc" }], skip: lList.skip, take: lList.take }),
    db.employeeLeave.count({ where: lWhere }),
    db.schedulePublication.findMany({ where: pWhere, select: { id: true, storeId: true, groupKind: true, fromAt: true, toAt: true, version: true, publishedByName: true, publishedAt: true }, orderBy: [{ publishedAt: pList.sort === "published" ? pList.dir : "desc" }, { id: "desc" }], skip: pList.skip, take: pList.take }),
    db.schedulePublication.count({ where: pWhere }),
  ]);
  const now = new Date();
  const payroll = canPay ? await staffPayrollSummary(ctx, new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)) : [];
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const storeOptions: [string, string][] = [...(restricted ? [] : [["", "Χωρίς κατάστημα"] as [string, string]]), ...stores.map((store): [string, string] => [store.id, store.name])];
  const warehouseOptions: [string, string][] = [...(restricted ? [] : [["", "Χωρίς αποθήκη"] as [string, string]]), ...warehouses.map((row): [string, string] => [row.id, row.name])];
  const canAdd = ctx.can("staff.add");
  const canEdit = ctx.can("staff.edit");
  const createEmployee = canAdd ? <Modal label={<><UserPlus /> Εργαζόμενος</>} title="Νέος εργαζόμενος"><form action={newEmployee} className="grid gap-3 sm:grid-cols-2"><Field label="Ονοματεπώνυμο" name="name" required maxLength={150} /><Select label="Τμήμα" name="departmentId" options={[["", "Χωρίς τμήμα"], ...departments.map((row): [string, string] => [row.id, row.name])]} /><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Select label="Αποθήκη" name="warehouseId" options={warehouseOptions} /><Field label="Τηλέφωνο" name="phone" maxLength={40} /><Field label="Email" name="email" type="email" maxLength={160} /><Field label="Έναρξη" name="startDate" type="date" /><Field label="Λήξη" name="endDate" type="date" /><Submit className={btn("default", "default", "sm:col-span-2")}>Αποθήκευση εργαζομένου</Submit></form></Modal> : null;
  const createShift = canAdd ? <Modal label={<><CalendarPlus /> Βάρδια</>} title="Νέα βάρδια"><form action={newShift} className="grid gap-3 sm:grid-cols-2"><Select label="Εργαζόμενος" name="employeeId" required options={employees.filter((employee) => employee.active).map((row): [string, string] => [row.id, row.name])} /><Select label="Τμήμα" name="departmentId" options={[["", "Τμήμα εργαζομένου"], ...departments.map((row): [string, string] => [row.id, row.name])]} /><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Field label="Διάλειμμα (λεπτά)" name="breakMinutes" type="number" min={0} max={1440} defaultValue={0} required /><Field label="Έναρξη" name="startsAt" type="datetime-local" required /><Field label="Λήξη" name="endsAt" type="datetime-local" required />{canPay ? <Field label="Ωρομίσθιο βάρδιας € (προαιρετικά)" name="hourlyRate" inputMode="decimal" /> : null}<div className="sm:col-span-2"><TextareaField label="Σημείωση" name="note" maxLength={500} /></div><Submit className={btn("default", "default", "sm:col-span-2")}>Αποθήκευση βάρδιας</Submit></form></Modal> : null;
  const createLeave = canAdd ? <Modal size="sm" label={<><Plus /> Άδεια</>} title="Καταχώριση άδειας"><form action={newLeave} className="grid gap-3"><Select label="Εργαζόμενος" name="employeeId" options={employees.map((row): [string, string] => [row.id, row.name])} /><Select label="Είδος" name="kind" options={LEAVE_KINDS} /><Field label="Από" name="fromAt" type="datetime-local" required /><Field label="Έως" name="toAt" type="datetime-local" required /><TextareaField label="Σημείωση" name="note" maxLength={500} /><Submit className={btn("default")}>Καταχώριση</Submit></form></Modal> : null;
  const publish = canEdit ? <Modal label={<><Send /> Δημοσίευση</>} title="Δημοσίευση προγράμματος"><form action={publishStaffSchedule} className="grid gap-3"><Select label="Κατάστημα" name="storeId" options={storeOptions} /><Select label="Ομάδα" name="groupKind" options={[["store", "Κατάστημα"], ["production", "Παραγωγή"]]} /><Field label="Από" name="fromAt" type="datetime-local" required /><Field label="Έως" name="toAt" type="datetime-local" required /><Submit className={btn("default")}>Δημιουργία snapshot</Submit></form></Modal> : null;
  const emptyWith = (text: string, action: React.ReactNode) => <><p>{text}</p>{action ? <div className="mt-3 flex justify-center">{action}</div> : null}</>;
  return <Page section="Ομάδα & δεδομένα" title="Προσωπικό & βάρδιες" description="Τμήματα, εργαζόμενοι, άδειες, δημοσιευμένα προγράμματα και εργατικό κόστος με ξεχωριστό απόρρητο" actions={<span className="flex flex-wrap gap-2">{canAdd ? <Modal label={<><Building /> Τμήμα</>} title="Νέο τμήμα"><form action={newDepartment} className="grid gap-3"><Field label="Όνομα" name="name" required maxLength={100} /><Select label="Είδος" name="kind" options={[["store", "Κατάστημα"], ["production", "Παραγωγή"], ["office", "Γραφείο"], ["other", "Άλλο"]]} /><Submit className={btn("default")}>Αποθήκευση</Submit></form></Modal> : null}{createEmployee}{createShift}{publish}</span>}>
    <div className="grid gap-5">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      <section className="min-w-0"><h2 className="mb-3 font-semibold">Εργαζόμενοι</h2><Card>
        <DataTable
          id="staff-employees"
          listing={{ ...eList, total: staffTotal, placeholder: "Όνομα, email ή τηλέφωνο", keys: keysOf("e"), params: others(query, "e", ["eactive"]), filters: [{ key: "eactive", label: "Κατάσταση", value: eActive, options: [["yes", "Ενεργοί"], ["no", "Ανενεργοί"]] }] }}
          empty={emptyWith("Εδώ είναι οι εργαζόμενοι που έχεις δικαίωμα να βλέπεις. Δεν υπάρχει κανένας ακόμα.", createEmployee)}
          columns={[
            { key: "name", label: "Ονοματεπώνυμο", required: true, sortable: true },
            { key: "department", label: "Τμήμα" },
            { key: "store", label: "Κατάστημα" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Τηλέφωνο" },
            ...(canPay ? [{ key: "pay", label: "Αμοιβή", numeric: true }] : []),
            { key: "status", label: "Κατάσταση" },
          ]}
          rows={staff.map((employee) => ({
            id: employee.id,
            cells: {
              name: <span className="font-semibold">{employee.name}</span>,
              department: (employee.departmentId ? departmentNames.get(employee.departmentId) : null) ?? "Χωρίς τμήμα",
              store: (employee.storeId ? storeNames.get(employee.storeId) : null) ?? "Χωρίς κατάστημα",
              email: employee.email ?? "—",
              phone: employee.phone ?? "—",
              pay: employee.pay?.payType === "MONTHLY" ? `${money(employee.pay.monthlySalaryCents)} / μήνα` : `${money(employee.pay?.hourlyRateCents)} / ώρα`,
              status: <StatusBadge look={employee.active ? look("success", "Ενεργός") : look("neutral", "Ανενεργός")} />,
            },
            // σύνδεσμος προγράμματος και στοιχεία αμοιβής ανοίγουν κάτω από τη γραμμή
            details: canEdit || canPay ? {
              label: employee.name,
              view: <div className="flex flex-wrap items-start gap-3">{canEdit ? <ScheduleLinkForm employeeId={employee.id} /> : null}{canPay ? <Modal size="sm" label="Στοιχεία αμοιβής" title={`Αμοιβή · ${employee.name}`}><form action={employeePay} className="grid gap-3"><input type="hidden" name="employeeId" value={employee.id} /><Select label="Τύπος" name="payType" defaultValue={employee.pay?.payType ?? "HOURLY"} options={[["HOURLY", "Ωρομίσθιο"], ["MONTHLY", "Μηνιαίος μισθός"]]} /><Field label="Ωρομίσθιο €" name="hourlyRate" inputMode="decimal" defaultValue={((employee.pay?.hourlyRateCents ?? 0) / 100).toFixed(2)} /><Field label="Μηνιαίος μισθός €" name="monthlySalary" inputMode="decimal" defaultValue={((employee.pay?.monthlySalaryCents ?? 0) / 100).toFixed(2)} /><Field label="IBAN" name="iban" defaultValue={employee.pay?.iban ?? ""} maxLength={34} /><Field label="ΑΦΜ" name="vatNumber" defaultValue={employee.pay?.vatNumber ?? ""} maxLength={20} /><TextareaField label="Σημειώσεις" name="notes" defaultValue={employee.pay?.notes ?? ""} maxLength={500} /><Submit className={btn("default")}>Αποθήκευση αμοιβής</Submit></form></Modal> : null}</div>,
            } : undefined,
          }))}
        />
      </Card></section>
      <section className="min-w-0"><h2 className="mb-3 font-semibold">Βάρδιες</h2><Card>
        <DataTable
          id="staff-shifts"
          listing={{ ...sList, total: shiftTotal, placeholder: "Εργαζόμενος ή σημείωση", keys: keysOf("s"), params: others(query, "s") }}
          empty={emptyWith("Εδώ φαίνονται οι βάρδιες των εργαζομένων σου, οι πιο πρόσφατες πρώτα. Δεν έχει μπει καμία ακόμα.", createShift)}
          columns={[
            { key: "employee", label: "Εργαζόμενος", required: true },
            { key: "start", label: "Έναρξη", sortable: true },
            { key: "end", label: "Λήξη" },
            { key: "break", label: "Διάλειμμα (λεπτά)", numeric: true },
            { key: "place", label: "Τμήμα / κατάστημα" },
            ...(canPay ? [{ key: "rate", label: "Ωρομίσθιο", numeric: true, sortable: true }] : []),
          ]}
          rows={shifts.map((shift) => ({
            id: shift.id,
            cells: {
              employee: <span className="font-medium">{employeeNames.get(shift.employeeId)}</span>,
              start: dateTime(shift.startsAt),
              end: dateTime(shift.endsAt),
              break: shift.breakMinutes,
              place: <>{(shift.departmentId ? departmentNames.get(shift.departmentId) : null) ?? "—"} · {(shift.storeId ? storeNames.get(shift.storeId) : null) ?? "—"}</>,
              rate: shift.hourlyRateCents == null ? "Κατάλογος εργαζομένου" : money(shift.hourlyRateCents),
            },
          }))}
        />
      </Card></section>
      <section className="min-w-0"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Άδειες</h2>{createLeave}</div><Card>
        <DataTable
          id="staff-leaves"
          listing={{ ...lList, total: leaveTotal, placeholder: "Εργαζόμενος ή σημείωση", keys: keysOf("l"), params: others(query, "l", ["lkind"]), filters: [{ key: "lkind", label: "Είδος", value: lKind, options: LEAVE_KINDS }] }}
          empty={emptyWith("Εδώ καταγράφονται οι άδειες του προσωπικού. Δεν υπάρχει καμία ακόμα.", createLeave)}
          columns={[
            { key: "employee", label: "Εργαζόμενος", required: true },
            { key: "kind", label: "Είδος" },
            { key: "from", label: "Από", sortable: true },
            { key: "to", label: "Έως" },
          ]}
          rows={leaves.map((leave) => ({
            id: leave.id,
            cells: {
              employee: <span className="font-medium">{employeeNames.get(leave.employeeId)}</span>,
              kind: LEAVE_KINDS.find(([value]) => value === leave.kind)?.[1] ?? "Άλλη",
              from: dateTime(leave.fromAt),
              to: dateTime(leave.toAt),
            },
          }))}
        />
      </Card></section>
      <section className="min-w-0"><h2 className="mb-3 font-semibold">Δημοσιεύσεις</h2><Card>
        <DataTable
          id="staff-publications"
          listing={{ ...pList, total: publicationTotal, placeholder: "Κατάστημα ή ποιος δημοσίευσε", keys: keysOf("p"), params: others(query, "p") }}
          empty={emptyWith("Εδώ μένει κάθε πρόγραμμα βαρδιών που δημοσίευσες, για να το κατεβάσεις ή να το στείλεις. Δεν έχεις δημοσιεύσει κανένα ακόμα.", publish)}
          columns={[
            { key: "version", label: "Έκδοση", required: true },
            { key: "store", label: "Κατάστημα" },
            { key: "period", label: "Διάστημα" },
            { key: "by", label: "Από" },
            { key: "published", label: "Δημοσιεύτηκε", sortable: true },
            { key: "files", label: "Αρχεία", wrap: true },
          ]}
          rows={publications.map((publication) => ({
            id: publication.id,
            cells: {
              version: <span className="font-semibold">Έκδοση {publication.version}</span>,
              store: (publication.storeId ? storeNames.get(publication.storeId) : "Όλα") ?? "—",
              period: <>{dateTime(publication.fromAt)} → {dateTime(publication.toAt)}</>,
              by: publication.publishedByName,
              published: dateTime(publication.publishedAt),
              files: <ScheduleExportLinks publicationId={publication.id} />,
            },
          }))}
        />
      </Card></section>
      {canPay ? <Card className="p-4"><h2 className="mb-3 font-semibold">Εργατικό κόστος τρέχοντος μήνα</h2><div className="grid gap-2 text-sm">{payroll.map((row) => <div key={row.employeeId} className="flex justify-between border-b border-border/60 py-2 last:border-0"><span>{row.name} · {(row.minutes / 60).toLocaleString("el-GR", { maximumFractionDigits: 2 })} ώρες</span><strong>{euro(row.costCents)}</strong></div>)}{!payroll.length ? <p className="text-sm text-muted-foreground">Δεν υπάρχουν βάρδιες στον μήνα.</p> : null}</div></Card> : null}
    </div>
  </Page>;
}
