// Επαναλήψιμο demo μόνο σε isolated βάση· δεν δημιουργεί users, credentials, sessions ή fiscal calls.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { ALL_MODULES } from "../lib/modules";
import { SYSTEM_ROLES } from "../lib/permissions";

export const DEMO_IDS = {
  org: "demo_org_001", store: "demo_store_001", warehouse: "demo_warehouse_001", shopWarehouse: "demo_warehouse_002",
  device: "demo_device_001", supplier: "demo_party_supplier", customer: "demo_party_customer",
  milk: "demo_item_milk", sugar: "demo_item_sugar", base: "demo_item_base", final: "demo_item_final",
  baseRecipe: "demo_recipe_base", finalRecipe: "demo_recipe_final", plan: "demo_production_plan_001",
} as const;

function assertIsolatedDatabase(connectionString: string | undefined) {
  if (process.env.DEMO_SEED_CONFIRM !== "isolated") throw new Error("Το demo seed απαιτεί DEMO_SEED_CONFIRM=isolated");
  if (!connectionString) throw new Error("Λείπει DATABASE_URL");
  const database = new URL(connectionString).pathname.replace(/^\//, "");
  if (!database.startsWith("gelato_agent_")) throw new Error("Το demo seed επιτρέπεται μόνο σε βάση gelato_agent_*");
}

export async function seedDemoDatabase(client: PrismaClient) {
  return client.$transaction(async (tx) => {
    const now = new Date();
    const today = new Date(now.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }) + "T12:00:00.000Z");
    const org = await tx.organization.upsert({ where: { id: DEMO_IDS.org }, update: { name: "Gelato System · Demo", legalName: "Demo Επιχείρηση Παγωτού", address: "Δοκιμαστική 1", city: "Πειραιάς", contactEmail: null, vivaMerchantId: null, aadeUserId: null, aadeSubKey: null }, create: { id: DEMO_IDS.org, name: "Gelato System · Demo", legalName: "Demo Επιχείρηση Παγωτού", vatNumber: "DEMO-NO-VAT-001", address: "Δοκιμαστική 1", city: "Πειραιάς" } });
    for (const [index, role] of SYSTEM_ROLES.entries()) await tx.orgRole.upsert({ where: { orgId_name: { orgId: org.id, name: role.name } }, update: { permissions: role.permissions, locked: role.locked, system: true }, create: { id: `demo_role_${index}`, orgId: org.id, ...role } });
    await tx.plan.upsert({ where: { id: "demo_plan_all" }, update: { modules: [...ALL_MODULES], active: true, isDefault: false }, create: { id: "demo_plan_all", name: "Demo · Όλες οι λειτουργίες", modules: [...ALL_MODULES], storeCents: 0, devicePrices: {}, pausedModules: [] } });
    await tx.subscription.upsert({ where: { orgId: org.id }, update: { planId: "demo_plan_all", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() + 30 * 864e5) }, create: { orgId: org.id, planId: "demo_plan_all", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() + 30 * 864e5) } });
    await tx.store.upsert({ where: { id: DEMO_IDS.store }, update: { name: "Demo Κατάστημα", active: true }, create: { id: DEMO_IDS.store, orgId: org.id, name: "Demo Κατάστημα", address: "Δοκιμαστική 1, Πειραιάς" } });
    for (const warehouse of [{ id: DEMO_IDS.warehouse, code: "LAB", name: "Demo Εργαστήριο" }, { id: DEMO_IDS.shopWarehouse, code: "SHOP", name: "Demo Ψυγείο καταστήματος" }]) {
      await tx.warehouse.upsert({ where: { id: warehouse.id }, update: { ...warehouse, active: true }, create: { ...warehouse, orgId: org.id } });
      await tx.storeWarehouse.upsert({ where: { storeId_warehouseId: { storeId: DEMO_IDS.store, warehouseId: warehouse.id } }, update: { isDefault: warehouse.id === DEMO_IDS.warehouse }, create: { storeId: DEMO_IDS.store, warehouseId: warehouse.id, isDefault: warehouse.id === DEMO_IDS.warehouse } });
    }
    await tx.device.upsert({ where: { id: DEMO_IDS.device }, update: { name: "Demo Ταμείο", active: true, defaultWarehouseId: DEMO_IDS.shopWarehouse }, create: { id: DEMO_IDS.device, orgId: org.id, storeId: DEMO_IDS.store, name: "Demo Ταμείο", kind: "POS_WEB", series: "DEMO", defaultWarehouseId: DEMO_IDS.shopWarehouse, pairedAt: now } });
    const vat24 = await tx.vatRate.upsert({ where: { id: "vat_24" }, update: { rate: 24, active: true }, create: { id: "vat_24", name: "ΦΠΑ 24%", rate: 24 } });
    const vat13 = await tx.vatRate.upsert({ where: { id: "vat_13" }, update: { rate: 13, active: true }, create: { id: "vat_13", name: "ΦΠΑ 13%", rate: 13 } });
    await tx.category.upsert({ where: { id: "demo_category_gelato" }, update: { name: "Παγωτό", position: 0 }, create: { id: "demo_category_gelato", orgId: org.id, name: "Παγωτό" } });
    await tx.product.upsert({ where: { id: "demo_product_vanilla" }, update: { name: "Demo Βανίλια · 1 kg", priceCents: 2200, vatRateId: vat13.id, active: true }, create: { id: "demo_product_vanilla", orgId: org.id, categoryId: "demo_category_gelato", vatRateId: vat13.id, name: "Demo Βανίλια · 1 kg", priceCents: 2200 } });
    await tx.product.upsert({ where: { id: "demo_product_cone" }, update: { name: "Demo Χωνάκι 2 μπάλες", priceCents: 450, vatRateId: vat13.id, active: true }, create: { id: "demo_product_cone", orgId: org.id, categoryId: "demo_category_gelato", vatRateId: vat13.id, name: "Demo Χωνάκι 2 μπάλες", priceCents: 450 } });
    await tx.party.upsert({ where: { id: DEMO_IDS.supplier }, update: { name: "Demo Προμηθευτής Γαλακτοκομικών", roles: ["supplier"], active: true }, create: { id: DEMO_IDS.supplier, orgId: org.id, name: "Demo Προμηθευτής Γαλακτοκομικών", roles: ["supplier"], email: "supplier@example.test" } });
    await tx.party.upsert({ where: { id: DEMO_IDS.customer }, update: { name: "Demo Ξενοδοχείο", roles: ["customer"], active: true }, create: { id: DEMO_IDS.customer, orgId: org.id, name: "Demo Ξενοδοχείο", roles: ["customer"], email: "customer@example.test", creditLimitCents: 100_000, paymentTermsDays: 30 } });
    const unit = await tx.unit.findFirst({ where: { code: "mg", active: true } }) ?? await tx.unit.create({ data: { code: "mg", nameEL: "χιλιοστόγραμμο", dimension: "mass", toBase: 1 } });
    for (const item of [
      { id: DEMO_IDS.milk, name: "Demo Γάλα", cost: 120, min: 5_000_000 },
      { id: DEMO_IDS.sugar, name: "Demo Ζάχαρη", cost: 150, min: 3_000_000 },
      { id: DEMO_IDS.base, name: "Demo Βάση παγωτού", cost: 250, min: 2_000_000 },
      { id: DEMO_IDS.final, name: "Demo Παγωτό βανίλια", cost: 500, min: 2_000_000 },
    ]) {
      await tx.genericItem.upsert({ where: { id: item.id }, update: { name: item.name, baseUnitId: unit.id, active: true }, create: { id: item.id, orgId: org.id, name: item.name, baseUnitId: unit.id, avgCostHundredths: item.cost, vatRateId: vat24.id } });
      await tx.stockThreshold.upsert({ where: { orgId_warehouseId_genericItemId: { orgId: org.id, warehouseId: DEMO_IDS.warehouse, genericItemId: item.id } }, update: { minimumQty: item.min }, create: { orgId: org.id, warehouseId: DEMO_IDS.warehouse, genericItemId: item.id, minimumQty: item.min } });
    }
    for (const [index, lot] of [
      { item: DEMO_IDS.milk, quantity: 20_000_000, cost: 120, code: "DEMO-MILK-A", days: 10 },
      { item: DEMO_IDS.sugar, quantity: 10_000_000, cost: 150, code: "DEMO-SUGAR-A", days: 180 },
      { item: DEMO_IDS.base, quantity: 2_000_000, cost: 250, code: "DEMO-BASE-A", days: 5 },
    ].entries()) {
      const lotId = `demo_lot_${index}`;
      await tx.stockLot.upsert({ where: { id: lotId }, update: { expiresAt: new Date(now.getTime() + lot.days * 864e5), holdStatus: "AVAILABLE" }, create: { id: lotId, orgId: org.id, genericItemId: lot.item, warehouseId: DEMO_IDS.warehouse, batchNumber: lot.code, expiresAt: new Date(now.getTime() + lot.days * 864e5) } });
      await tx.stockMovement.upsert({ where: { id: `demo_stock_${index}` }, update: {}, create: { id: `demo_stock_${index}`, orgId: org.id, warehouseId: DEMO_IDS.warehouse, genericItemId: lot.item, lotId, quantity: lot.quantity, unitCostHundredths: lot.cost, source: "demo_seed", note: "Δοκιμαστικό αρχικό απόθεμα", occurredAt: now, createdByName: "Demo seed" } });
    }
    await tx.recipe.upsert({ where: { id: DEMO_IDS.baseRecipe }, update: { name: "Demo Βάση", batchGrams: 1000, outputGenericItemId: DEMO_IDS.base, shelfLifeDays: 5, active: true }, create: { id: DEMO_IDS.baseRecipe, orgId: org.id, name: "Demo Βάση", batchGrams: 1000, outputGenericItemId: DEMO_IDS.base, shelfLifeDays: 5 } });
    await tx.recipe.upsert({ where: { id: DEMO_IDS.finalRecipe }, update: { name: "Demo Βανίλια", batchGrams: 2000, outputGenericItemId: DEMO_IDS.final, productId: "demo_product_vanilla", shelfLifeDays: 7, active: true }, create: { id: DEMO_IDS.finalRecipe, orgId: org.id, name: "Demo Βανίλια", batchGrams: 2000, outputGenericItemId: DEMO_IDS.final, productId: "demo_product_vanilla", shelfLifeDays: 7 } });
    for (const line of [
      { id: "demo_recipe_line_1", recipeId: DEMO_IDS.baseRecipe, genericItemId: DEMO_IDS.milk, grams: 700, sortOrder: 0 },
      { id: "demo_recipe_line_2", recipeId: DEMO_IDS.baseRecipe, genericItemId: DEMO_IDS.sugar, grams: 300, sortOrder: 1 },
      { id: "demo_recipe_line_3", recipeId: DEMO_IDS.finalRecipe, genericItemId: DEMO_IDS.base, grams: 500, sortOrder: 0 },
      { id: "demo_recipe_line_4", recipeId: DEMO_IDS.finalRecipe, genericItemId: DEMO_IDS.milk, grams: 1500, sortOrder: 1 },
    ]) await tx.recipeItem.upsert({ where: { id: line.id }, update: line, create: { ...line, orgId: org.id } });
    await tx.productionPlan.upsert({ where: { id: DEMO_IDS.plan }, update: { plannedFor: today, quantityGrams: 2000, note: "Demo πλάνο για δοκιμή day close" }, create: { id: DEMO_IDS.plan, orgId: org.id, storeId: DEMO_IDS.store, recipeId: DEMO_IDS.finalRecipe, sourceWarehouseId: DEMO_IDS.warehouse, destinationWarehouseId: DEMO_IDS.shopWarehouse, plannedFor: today, quantityGrams: 2000, createdByName: "Demo seed" } });
    await tx.priceList.upsert({ where: { id: "demo_price_list" }, update: { name: "Demo Χονδρική", active: true, validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: null }, create: { id: "demo_price_list", orgId: org.id, name: "Demo Χονδρική", validFrom: new Date("2026-01-01T00:00:00.000Z") } });
    await tx.priceListParty.upsert({ where: { priceListId_partyId: { priceListId: "demo_price_list", partyId: DEMO_IDS.customer } }, update: {}, create: { orgId: org.id, priceListId: "demo_price_list", partyId: DEMO_IDS.customer } });
    await tx.priceListItem.upsert({ where: { priceListId_genericItemId: { priceListId: "demo_price_list", genericItemId: DEMO_IDS.final } }, update: { unitPriceCents: 1500, vatRate: 24 }, create: { orgId: org.id, priceListId: "demo_price_list", genericItemId: DEMO_IDS.final, unitPriceCents: 1500, vatRate: 24 } });
    await tx.documentSeries.upsert({ where: { orgId_docType_code: { orgId: org.id, docType: "1.1", code: "DEMO-W" } }, update: { storeId: DEMO_IDS.store }, create: { orgId: org.id, storeId: DEMO_IDS.store, docType: "1.1", code: "DEMO-W" } });
    await tx.financeAccount.upsert({ where: { id: "demo_finance_cash" }, update: { name: "Demo Ταμείο", kind: "cash", active: true }, create: { id: "demo_finance_cash", orgId: org.id, storeId: DEMO_IDS.store, name: "Demo Ταμείο", kind: "cash", openingAt: now } });
    await tx.financeAccount.upsert({ where: { id: "demo_finance_bank" }, update: { name: "Demo Τράπεζα", kind: "bank", active: true }, create: { id: "demo_finance_bank", orgId: org.id, name: "Demo Τράπεζα", kind: "bank", openingAt: now } });
    await tx.budgetTarget.upsert({ where: { id: "demo_budget" }, update: { year: now.getFullYear(), month: now.getMonth() + 1, salesCents: 500_000, cogsCents: 150_000, payrollCents: 80_000, expenseCents: 50_000 }, create: { id: "demo_budget", orgId: org.id, year: now.getFullYear(), month: now.getMonth() + 1, salesCents: 500_000, cogsCents: 150_000, payrollCents: 80_000, expenseCents: 50_000 } });
    await tx.department.upsert({ where: { id: "demo_department" }, update: { name: "Demo Παραγωγή", active: true }, create: { id: "demo_department", orgId: org.id, name: "Demo Παραγωγή", kind: "production" } });
    await tx.employee.upsert({ where: { id: "demo_employee" }, update: { name: "Demo Υπάλληλος", active: true }, create: { id: "demo_employee", orgId: org.id, departmentId: "demo_department", storeId: DEMO_IDS.store, warehouseId: DEMO_IDS.warehouse, name: "Demo Υπάλληλος", email: "employee@example.test" } });
    await tx.employeePay.upsert({ where: { employeeId: "demo_employee" }, update: { payType: "HOURLY", hourlyRateCents: 800, iban: null, vatNumber: null }, create: { orgId: org.id, employeeId: "demo_employee", payType: "HOURLY", hourlyRateCents: 800, notes: "Εντελώς δοκιμαστική αμοιβή" } });
    return { orgId: org.id, storeId: DEMO_IDS.store, warehouseId: DEMO_IDS.warehouse, planId: DEMO_IDS.plan, seededAt: now.toISOString() };
  }, { timeout: 120_000, maxWait: 10_000 });
}

async function main() {
  assertIsolatedDatabase(process.env.DATABASE_URL);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = await seedDemoDatabase(client);
    console.log(`Demo έτοιμο: ${result.orgId} · κατάστημα ${result.storeId} · πλάνο ${result.planId}`);
    console.log("Δεν δημιουργήθηκαν users, passwords, sessions, MARK ή myDATA κλήσεις.");
  } finally { await client.$disconnect(); }
}

if (process.argv[1]?.endsWith("demo-seed.ts")) main().catch((error) => { console.error(error instanceof Error ? error.message : "Το demo seed απέτυχε"); process.exitCode = 1; });
