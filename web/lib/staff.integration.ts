import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "./db.ts";
import { acknowledgeSchedule, createLeave, createScheduleLink, createShift, publicSchedule, publishSchedule, saveDepartment, saveEmployee, saveEmployeePay, staffPayrollSummary } from "./staff-db.ts";
import type { Permission } from "./permissions.ts";
import type { StockContext } from "./stock-scope.ts";
import { WorkflowError } from "./workflow-db.ts";

const databaseOptions = { skip: !process.env.DATABASE_URL };

async function fixture() {
  const suffix = randomUUID();
  const org = await db.organization.create({ data: { name: `STAFF integration ${suffix}`, vatNumber: `TEST-${suffix}` } });
  const user = await db.user.create({ data: { email: `staff-${suffix}@example.test`, name: "HR integration" } });
  const role = await db.orgRole.create({ data: { orgId: org.id, name: "HR integration", permissions: ["staff.read", "staff.add", "staff.edit", "staff.pay"] } });
  const membership = await db.membership.create({ data: { orgId: org.id, userId: user.id, roleId: role.id } });
  const store = await db.store.create({ data: { orgId: org.id, name: "Κατάστημα HR integration" } });
  const otherStore = await db.store.create({ data: { orgId: org.id, name: "Άλλο κατάστημα HR" } });
  await db.membershipStore.create({ data: { membershipId: membership.id, storeId: store.id } });
  return { orgId: org.id, userId: user.id, membershipId: membership.id, storeId: store.id, otherStoreId: otherStore.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture, pay: boolean, restricted = false): StockContext {
  const permissions: Permission[] = ["staff.read", "staff.add", "staff.edit", ...(pay ? ["staff.pay" as const] : [])];
  return { orgId: f.orgId, userId: f.userId, membershipId: f.membershipId, userName: "HR integration", permissions, storeIds: restricted ? [f.storeId] : [], warehouseIds: [], can: (permission) => permissions.includes(permission as "staff.pay") };
}

test("PostgreSQL STF: pay privacy, overlap, publications, token isolation και payroll", databaseOptions, async () => {
  const f = await fixture();
  const full = context(f, true);
  const noPay = context(f, false);
  try {
    const department = await saveDepartment(full, { name: `Παραγωγή ${randomUUID()}`, kind: "production" });
    const employee = await saveEmployee(full, { name: "Εργαζόμενος Α integration", departmentId: department.id, storeId: f.storeId });
    const other = await saveEmployee(full, { name: "Εργαζόμενος Β integration", departmentId: department.id, storeId: f.otherStoreId });
    await assert.rejects(saveEmployeePay(noPay, employee.id, { payType: "HOURLY", hourlyRateCents: 750, monthlySalaryCents: 0 }), WorkflowError);
    await saveEmployeePay(full, employee.id, { payType: "HOURLY", hourlyRateCents: 750, monthlySalaryCents: 0, iban: "GR16 0110 1250 0000 0001 2300 695", vatNumber: "123456789" });
    await assert.rejects(createShift(noPay, { employeeId: employee.id, startsAt: new Date("2026-11-24T08:00:00.000Z"), endsAt: new Date("2026-11-24T12:00:00.000Z"), hourlyRateCents: 750 }), WorkflowError);
    const shift = await createShift(full, { employeeId: employee.id, startsAt: new Date("2026-11-24T08:00:00.000Z"), endsAt: new Date("2026-11-24T12:00:00.000Z"), breakMinutes: 30, hourlyRateCents: 750 });
    await createShift(full, { employeeId: other.id, startsAt: new Date("2026-11-24T08:00:00.000Z"), endsAt: new Date("2026-11-24T10:00:00.000Z") });
    await assert.rejects(createShift(full, { employeeId: employee.id, startsAt: new Date("2026-11-24T11:00:00.000Z"), endsAt: new Date("2026-11-24T15:00:00.000Z") }), /έχει ήδη βάρδια/);
    await assert.rejects(createLeave(full, { employeeId: employee.id, kind: "annual", fromAt: new Date("2026-11-24T00:00:00.000Z"), toAt: new Date("2026-11-25T00:00:00.000Z") }), /Μετακίνησε/);
    await createLeave(full, { employeeId: employee.id, kind: "annual", fromAt: new Date("2026-11-25T00:00:00.000Z"), toAt: new Date("2026-11-26T00:00:00.000Z") });
    const first = await publishSchedule(full, { fromAt: new Date("2026-11-24T00:00:00.000Z"), toAt: new Date("2026-11-25T00:00:00.000Z") });
    const second = await publishSchedule(full, { fromAt: new Date("2026-11-24T00:00:00.000Z"), toAt: new Date("2026-11-25T00:00:00.000Z") });
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    const own = await createScheduleLink(full, employee.id);
    const foreign = await createScheduleLink(full, other.id);
    assert.equal(await db.scheduleLink.count({ where: { orgId: f.orgId, tokenHash: own.token } }), 0);
    const ownSchedule = await publicSchedule(own.token);
    const otherSchedule = await publicSchedule(foreign.token);
    assert.equal(ownSchedule.employee.id, employee.id);
    assert.ok(ownSchedule.publications.every((publication) => publication.shifts.every((row) => row.employeeId === employee.id)));
    assert.ok(otherSchedule.publications.every((publication) => publication.shifts.every((row) => row.employeeId === other.id)));
    assert.ok(!JSON.stringify(ownSchedule).includes("750"));
    await acknowledgeSchedule(own.token, 1);
    assert.equal((await publicSchedule(own.token)).acknowledgedVersion, 1);
    await acknowledgeSchedule(own.token, 2);
    assert.equal((await publicSchedule(own.token)).acknowledgedVersion, 2);
    const payroll = await staffPayrollSummary(full, new Date("2026-11-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z"));
    assert.equal(payroll.find((row) => row.employeeId === employee.id)?.minutes, 210);
    assert.equal(payroll.find((row) => row.employeeId === employee.id)?.costCents, 2625);
    await assert.rejects(staffPayrollSummary(noPay, new Date("2026-11-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z")), WorkflowError);
    await assert.rejects(saveEmployeePay(context(f, true, true), other.id, { payType: "HOURLY", hourlyRateCents: 1, monthlySalaryCents: 0 }));
    assert.ok(shift.id);
  } finally {
    await db.schedulePublication.deleteMany({ where: { orgId: f.orgId } });
    await db.shift.deleteMany({ where: { orgId: f.orgId } });
    await db.employeeLeave.deleteMany({ where: { orgId: f.orgId } });
    await db.scheduleLink.deleteMany({ where: { orgId: f.orgId } });
    await db.employeePay.deleteMany({ where: { orgId: f.orgId } });
    await db.employee.deleteMany({ where: { orgId: f.orgId } });
    await db.organization.deleteMany({ where: { id: f.orgId } });
    await db.user.deleteMany({ where: { id: f.userId } });
  }
});
