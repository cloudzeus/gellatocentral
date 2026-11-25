// Βιτρίνα: ρυθμίσεις ανά κατάστημα, ασφαλή tokens, immutable δημόσια snapshots και ανώνυμοι ημερήσιοι μετρητές.
import { randomBytes } from "node:crypto";
import type { Prisma } from "./generated/prisma/client";
import { db } from "./db";
import { expandRecipe } from "./recipe-graph";
import { assertStockScope, type StockContext } from "./stock-scope";
import { stockTransaction } from "./stock-transaction";
import { buildVitrineSnapshot, publicVitrineItems, publicVitrineSubscription } from "./vitrine";
import { hashAccessToken } from "./wholesale";
import { assertNonNegativeInt, auditWorkflow, cleanText, WorkflowError } from "./workflow-db";

type Tx = Prisma.TransactionClient;
const actor = (ctx: StockContext) => ({ id: ctx.userId, name: ctx.userName });

async function ownedSetting(tx: Tx, ctx: StockContext, storeId: string, forWrite = true) {
  await assertStockScope(tx, ctx, { storeId, forWrite });
  const setting = await tx.vitrineSetting.findFirst({ where: { orgId: ctx.orgId, storeId } });
  if (!setting) throw new WorkflowError("Ρύθμισε πρώτα τη βιτρίνα του καταστήματος");
  if (setting.warehouseId) await assertStockScope(tx, ctx, { storeId, warehouseId: setting.warehouseId, forWrite });
  return setting;
}

export async function saveVitrineSetting(ctx: StockContext, input: { storeId: string; published: boolean; selectionMode: string; warehouseId?: string | null; languages: string[]; showPrices: boolean; showAllergens: boolean; tvPageSeconds: number }) {
  if (!["manual", "auto"].includes(input.selectionMode)) throw new WorkflowError("Άκυρος τρόπος επιλογής βιτρίνας");
  if (input.selectionMode === "auto" && !input.warehouseId) throw new WorkflowError("Η αυτόματη βιτρίνα απαιτεί αποθήκη διαθεσιμότητας");
  const languages = [...new Set(input.languages.map((value) => value.trim().toLowerCase()).filter((value) => ["el", "en", "it"].includes(value)))];
  if (!languages.length) throw new WorkflowError("Επίλεξε τουλάχιστον μία γλώσσα");
  assertNonNegativeInt(input.tvPageSeconds, "Διάρκεια σελίδας", 300);
  if (input.tvPageSeconds < 3) throw new WorkflowError("Η διάρκεια σελίδας είναι 3–300 δευτερόλεπτα");
  return stockTransaction(async (tx) => {
    await assertStockScope(tx, ctx, { storeId: input.storeId, warehouseId: input.warehouseId ?? undefined, forWrite: true });
    const previous = await tx.vitrineSetting.findFirst({ where: { orgId: ctx.orgId, storeId: input.storeId } });
    const values = { published: input.published, selectionMode: input.selectionMode, warehouseId: input.warehouseId ?? null, languages, showPrices: input.showPrices, showAllergens: input.showAllergens, tvPageSeconds: input.tvPageSeconds };
    const setting = previous ? await tx.vitrineSetting.update({ where: { id: previous.id }, data: values }) : await tx.vitrineSetting.create({ data: { orgId: ctx.orgId, storeId: input.storeId, tokenHash: hashAccessToken(randomBytes(32).toString("base64url")), ...values } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "vitrine.settings", entityType: "vitrine_setting", entityId: setting.id, storeId: setting.storeId, warehouseId: setting.warehouseId, metadata: { published: setting.published, selectionMode: setting.selectionMode, languages } });
    return setting;
  });
}

export async function rotateVitrineToken(ctx: StockContext, storeId: string) {
  const token = randomBytes(32).toString("base64url");
  return stockTransaction(async (tx) => {
    const setting = await ownedSetting(tx, ctx, storeId);
    const updated = await tx.vitrineSetting.update({ where: { id: setting.id }, data: { tokenHash: hashAccessToken(token) } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "vitrine.token.rotate", entityType: "vitrine_setting", entityId: setting.id, storeId });
    return { token, setting: updated };
  });
}

async function availableByProduct(tx: Tx, orgId: string, warehouseId: string, products: readonly { id: string; genericItemId: string | null }[]) {
  const genericIds = [...new Set(products.map((row) => row.genericItemId).filter((id): id is string => Boolean(id)))];
  const lots = genericIds.length ? await tx.stockLot.findMany({ where: { orgId, warehouseId, genericItemId: { in: genericIds }, holdStatus: { in: ["AVAILABLE", "RELEASED"] } }, select: { id: true, genericItemId: true } }) : [];
  const sums = lots.length ? await tx.stockMovement.groupBy({ by: ["lotId"], where: { orgId, lotId: { in: lots.map((lot) => lot.id) } }, _sum: { quantity: true } }) : [];
  const balances = new Map(sums.map((row) => [row.lotId, row._sum.quantity ?? 0]));
  const available = new Map<string, boolean>();
  for (const genericId of genericIds) available.set(genericId, lots.some((lot) => lot.genericItemId === genericId && (balances.get(lot.id) ?? 0) > 0));
  return new Map(products.map((product) => [product.id, product.genericItemId ? available.get(product.genericItemId) === true : false]));
}

async function productSnapshots(tx: Tx, orgId: string) {
  const [products, recipes] = await Promise.all([
    tx.product.findMany({ where: { orgId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, priceCents: true } }),
    tx.recipe.findMany({ where: { orgId, active: true }, include: { items: { include: { genericItem: { include: { composition: true } } }, orderBy: { sortOrder: "asc" } } } }),
  ]);
  const genericById = new Map(recipes.flatMap((recipe) => recipe.items.map((item) => [item.genericItemId, item.genericItem] as const)));
  return products.map((product) => {
    const recipe = recipes.find((row) => row.productId === product.id && row.items.length > 0);
    let snapshot: unknown = buildVitrineSnapshot({ productName: product.name, priceCents: product.priceCents });
    if (recipe) {
      const expanded = expandRecipe(recipes, recipe.id, recipe.batchGrams);
      snapshot = buildVitrineSnapshot({ productName: product.name, priceCents: product.priceCents, recipeName: recipe.name, batchGrams: recipe.batchGrams, lines: expanded.lines.map((line) => { const generic = genericById.get(line.genericItemId); const composition = generic?.composition; return { name: generic?.name ?? "Συστατικό", grams: line.grams, composition: composition ? { ...composition, name: generic?.name ?? "Συστατικό", fatPct: composition.fatPm == null ? null : composition.fatPm / 100, msnfPct: composition.msnfPm == null ? null : composition.msnfPm / 100, sucrosePct: composition.sucrosePm == null ? null : composition.sucrosePm / 100, dextrosePct: composition.dextrosePm == null ? null : composition.dextrosePm / 100, glucoseSyrupPct: composition.glucoseSyrupPm == null ? null : composition.glucoseSyrupPm / 100, invertSugarPct: composition.invertSugarPm == null ? null : composition.invertSugarPm / 100, fructosePct: composition.fructosePm == null ? null : composition.fructosePm / 100, lactosePct: composition.lactosePm == null ? null : composition.lactosePm / 100, cocoaNonfatPct: composition.cocoaNonfatPm == null ? null : composition.cocoaNonfatPm / 100, stabilizerPct: composition.stabilizerPm == null ? null : composition.stabilizerPm / 100, emulsifierPct: composition.emulsifierPm == null ? null : composition.emulsifierPm / 100, saltPct: composition.saltPm == null ? null : composition.saltPm / 100, alcoholPct: composition.alcoholPm == null ? null : composition.alcoholPm / 100, otherSolidsPct: composition.otherSolidsPm == null ? null : composition.otherSolidsPm / 100, proteinAvailablePct: composition.proteinAvailablePm == null ? null : composition.proteinAvailablePm / 100, otherProteinPct: composition.otherProteinPm == null ? null : composition.otherProteinPm / 100, fiberPct: composition.fiberPm == null ? null : composition.fiberPm / 100, pacOverride: composition.pacOverridePm == null ? null : composition.pacOverridePm / 100, podOverride: composition.podOverridePm == null ? null : composition.podOverridePm / 100, totalSolidsOverride: composition.totalSolidsOverridePm == null ? null : composition.totalSolidsOverridePm / 100 } : null }; }) });
    }
    return { ...product, genericItemId: recipe?.outputGenericItemId ?? null, snapshot };
  });
}

export async function syncVitrineItems(ctx: StockContext, storeId: string) {
  return stockTransaction(async (tx) => {
    const setting = await ownedSetting(tx, ctx, storeId);
    const products = await productSnapshots(tx, ctx.orgId);
    const availability = setting.selectionMode === "auto" && setting.warehouseId ? await availableByProduct(tx, ctx.orgId, setting.warehouseId, products) : new Map<string, boolean>();
    for (const [position, product] of products.entries()) {
      const previous = await tx.vitrineItem.findUnique({ where: { settingId_productId: { settingId: setting.id, productId: product.id } } });
      const selected = setting.selectionMode === "auto" ? availability.get(product.id) === true : previous?.selected ?? true;
      const soldOut = setting.selectionMode === "auto" ? false : previous?.soldOut ?? false;
      await tx.vitrineItem.upsert({ where: { settingId_productId: { settingId: setting.id, productId: product.id } }, update: { genericItemId: product.genericItemId, snapshot: JSON.parse(JSON.stringify(product.snapshot)), selected, soldOut, position: previous?.position ?? position }, create: { orgId: ctx.orgId, settingId: setting.id, productId: product.id, genericItemId: product.genericItemId, snapshot: JSON.parse(JSON.stringify(product.snapshot)), selected, soldOut, position } });
    }
    const productIds = products.map((row) => row.id);
    await tx.vitrineItem.updateMany({ where: { orgId: ctx.orgId, settingId: setting.id, productId: { notIn: productIds } }, data: { selected: false } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "vitrine.sync", entityType: "vitrine_setting", entityId: setting.id, storeId, warehouseId: setting.warehouseId, metadata: { products: products.length, selected: setting.selectionMode === "auto" ? [...availability.values()].filter(Boolean).length : undefined } });
    return { products: products.length };
  });
}

export async function updateVitrineItem(ctx: StockContext, input: { itemId: string; selected: boolean; soldOut: boolean; position: number; priceCents?: number | null }) {
  assertNonNegativeInt(input.position, "Θέση", 100000);
  if (input.priceCents != null) assertNonNegativeInt(input.priceCents, "Τιμή");
  return stockTransaction(async (tx) => {
    const item = await tx.vitrineItem.findFirst({ where: { id: input.itemId, orgId: ctx.orgId }, include: { setting: true } });
    if (!item) throw new WorkflowError("Το προϊόν βιτρίνας δεν βρέθηκε");
    await ownedSetting(tx, ctx, item.setting.storeId);
    const auto = item.setting.selectionMode === "auto";
    const updated = await tx.vitrineItem.update({ where: { id: item.id }, data: { selected: auto ? item.selected : input.selected, soldOut: auto ? item.soldOut : input.soldOut, position: input.position, priceCents: input.priceCents ?? null } });
    await auditWorkflow(tx, { orgId: ctx.orgId, actor: actor(ctx), action: "vitrine.item", entityType: "vitrine_item", entityId: item.id, storeId: item.setting.storeId, metadata: { selected: updated.selected, soldOut: updated.soldOut, position: input.position, priceCents: input.priceCents ?? null } });
    return updated;
  });
}

export async function publicVitrine(token: string) {
  const setting = await db.vitrineSetting.findFirst({ where: { tokenHash: hashAccessToken(token), published: true }, include: { org: { include: { subscription: true } }, items: { orderBy: { position: "asc" } } } });
  if (!setting || !publicVitrineSubscription(setting.org)) throw new WorkflowError("Η βιτρίνα δεν είναι διαθέσιμη");
  const store = await db.store.findFirst({ where: { id: setting.storeId, orgId: setting.orgId, active: true }, include: { pauses: { where: { endedAt: null }, take: 1 } } });
  if (!store || store.pauses.length) throw new WorkflowError("Η βιτρίνα είναι προσωρινά εκτός λειτουργίας");
  const productIds = setting.items.map((item) => item.productId);
  const products = await db.product.findMany({ where: { orgId: setting.orgId, id: { in: productIds }, active: true }, select: { id: true, name: true, priceCents: true } });
  const productById = new Map(products.map((row) => [row.id, row]));
  const available = setting.selectionMode === "auto" && setting.warehouseId ? await availableByProduct(db, setting.orgId, setting.warehouseId, setting.items.map((item) => ({ id: item.productId, genericItemId: item.genericItemId }))) : new Map<string, boolean>();
  const items = publicVitrineItems(setting.items.filter((item) => productById.has(item.productId)).map((item) => ({ productId: item.productId, name: productById.get(item.productId)!.name, priceCents: item.priceCents ?? productById.get(item.productId)!.priceCents, position: item.position, snapshot: item.snapshot, selected: item.selected, soldOut: item.soldOut })), available);
  return { orgName: setting.org.name, logoUrl: setting.org.logoUrl, storeName: store.name, languages: setting.languages, showPrices: setting.showPrices, showAllergens: setting.showAllergens, tvPageSeconds: setting.tvPageSeconds, items };
}

export async function recordVitrineView(token: string) {
  const vitrine = await publicVitrine(token);
  const setting = await db.vitrineSetting.findFirstOrThrow({ where: { tokenHash: hashAccessToken(token), published: true }, select: { orgId: true, storeId: true } });
  const viewedOn = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" })}T00:00:00.000Z`);
  await db.vitrineDailyView.upsert({ where: { orgId_storeId_viewedOn: { orgId: setting.orgId, storeId: setting.storeId, viewedOn } }, update: { views: { increment: 1 } }, create: { orgId: setting.orgId, storeId: setting.storeId, viewedOn, views: 1 } });
  return vitrine;
}

export { cleanText };
