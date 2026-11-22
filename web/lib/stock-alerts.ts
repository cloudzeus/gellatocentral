// Read-only alerts: ρητά thresholds χαμηλού αποθέματος και θετικές παρτίδες με λήξη έως 30 ημερολογιακές ημέρες.
import { Prisma } from "./generated/prisma/client.ts";
import { daysUntil } from "./production.ts";
import { warehouseScopeWhere, type StockContext } from "./stock-scope.ts";
import type { StockUnitView } from "./stock-read.ts";
import { safeStockNumber } from "./stock-view.ts";

export type StockAlertDb = Pick<Prisma.TransactionClient, "warehouse" | "$queryRaw">;
export type StockAlertScope = Pick<StockContext, "orgId" | "storeIds" | "warehouseIds">;
export type StockExpiryBucket = "expired" | "0-3" | "4-7" | "8-30";

export const STOCK_EXPIRY_BUCKET_LABEL: Record<StockExpiryBucket, string> = {
  expired: "Ληγμένη",
  "0-3": "0–3 ημέρες",
  "4-7": "4–7 ημέρες",
  "8-30": "8–30 ημέρες",
};

/** Χωρίς ρητό threshold δεν υπάρχει low-stock alert· στο όριο 0 ειδοποιεί μόνο αρνητικό απόθεμα. */
export function isLowStock(quantity: number, minimumQty: number): boolean {
  return quantity < minimumQty;
}

export function stockExpiryBucket(expiresAt: Date | null, now = new Date()): StockExpiryBucket | null {
  const days = daysUntil(expiresAt, now);
  if (days === null || days > 30) return null;
  if (days < 0) return "expired";
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  return "8-30";
}

export type StockThresholdAlertRow = {
  thresholdId: string;
  warehouseId: string;
  warehouseName: string;
  genericItemId: string;
  itemName: string;
  quantity: number;
  minimumQty: number;
  baseUnit: StockUnitView;
};

export type StockExpiryAlertRow = {
  lotId: string;
  batchNumber: string | null;
  expiresAt: Date;
  warehouseId: string;
  warehouseName: string;
  genericItemId: string;
  itemName: string;
  quantity: number;
  baseUnit: StockUnitView;
  days: number;
  bucket: StockExpiryBucket;
};

type ThresholdSqlRow = {
  thresholdId: string;
  warehouseId: string;
  warehouseName: string;
  genericItemId: string;
  itemName: string;
  quantity: bigint | null;
  minimumQty: number;
  unitCode: string;
  unitDimension: string;
  unitToBase: number;
};

type ExpirySqlRow = {
  lotId: string;
  batchNumber: string | null;
  expiresAt: Date | null;
  warehouseId: string;
  warehouseName: string;
  genericItemId: string;
  itemName: string;
  quantity: bigint | null;
  unitCode: string;
  unitDimension: string;
  unitToBase: number;
};

/** Τα thresholds οδηγούν το query, ώστε να συμμετέχουν και είδη χωρίς καμία κίνηση (on-hand = 0). */
export async function stockAlerts(tx: StockAlertDb, ctx: StockAlertScope, now = new Date()) {
  const warehouses = await tx.warehouse.findMany({ where: warehouseScopeWhere(ctx), select: { id: true } });
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  if (!warehouseIds.length) return { thresholds: [] as StockThresholdAlertRow[], lowStock: [] as StockThresholdAlertRow[], expiringLots: [] as StockExpiryAlertRow[] };

  const thresholdRows = await tx.$queryRaw<ThresholdSqlRow[]>(Prisma.sql`
    SELECT
      t."id" AS "thresholdId", t."warehouseId", w."name" AS "warehouseName",
      t."genericItemId", gi."name" AS "itemName",
      COALESCE(SUM(m."quantity"), 0)::bigint AS quantity, t."minimumQty",
      u."code" AS "unitCode", u."dimension" AS "unitDimension", u."toBase" AS "unitToBase"
    FROM "StockThreshold" t
    JOIN "Warehouse" w ON w."id" = t."warehouseId" AND w."orgId" = t."orgId"
    JOIN "GenericItem" gi ON gi."id" = t."genericItemId" AND gi."orgId" = t."orgId"
    JOIN "Unit" u ON u."id" = gi."baseUnitId"
    LEFT JOIN "StockMovement" m ON m."orgId" = t."orgId"
      AND m."warehouseId" = t."warehouseId" AND m."genericItemId" = t."genericItemId"
    WHERE t."orgId" = ${ctx.orgId}
      AND t."warehouseId" IN (${Prisma.join(warehouseIds)})
      AND gi."trackStock" = TRUE
    GROUP BY t."id", t."warehouseId", w."name", t."genericItemId", gi."name", t."minimumQty", u."code", u."dimension", u."toBase"
    ORDER BY gi."name" ASC, w."name" ASC, t."id" ASC
  `);
  const thresholds = thresholdRows.map((row): StockThresholdAlertRow => ({
    thresholdId: row.thresholdId,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    genericItemId: row.genericItemId,
    itemName: row.itemName,
    quantity: safeStockNumber(row.quantity ?? 0),
    minimumQty: row.minimumQty,
    baseUnit: { code: row.unitCode, dimension: row.unitDimension, toBase: row.unitToBase },
  }));

  const expiryRows = await tx.$queryRaw<ExpirySqlRow[]>(Prisma.sql`
    SELECT
      l."id" AS "lotId", l."batchNumber", l."expiresAt",
      l."warehouseId", w."name" AS "warehouseName",
      l."genericItemId", gi."name" AS "itemName",
      SUM(m."quantity")::bigint AS quantity,
      u."code" AS "unitCode", u."dimension" AS "unitDimension", u."toBase" AS "unitToBase"
    FROM "StockLot" l
    JOIN "Warehouse" w ON w."id" = l."warehouseId" AND w."orgId" = l."orgId"
    JOIN "GenericItem" gi ON gi."id" = l."genericItemId" AND gi."orgId" = l."orgId"
    JOIN "Unit" u ON u."id" = gi."baseUnitId"
    JOIN "StockMovement" m ON m."orgId" = l."orgId" AND m."lotId" = l."id"
      AND m."warehouseId" = l."warehouseId" AND m."genericItemId" = l."genericItemId"
    WHERE l."orgId" = ${ctx.orgId}
      AND l."warehouseId" IN (${Prisma.join(warehouseIds)})
      AND l."expiresAt" IS NOT NULL
      AND gi."trackStock" = TRUE
    GROUP BY l."id", l."batchNumber", l."expiresAt", l."warehouseId", w."name", l."genericItemId", gi."name", u."code", u."dimension", u."toBase"
    HAVING SUM(m."quantity") > 0
    ORDER BY l."expiresAt" ASC, l."id" ASC
  `);
  const expiringLots = expiryRows.flatMap((row): StockExpiryAlertRow[] => {
    if (!row.expiresAt) return [];
    const bucket = stockExpiryBucket(row.expiresAt, now);
    const days = daysUntil(row.expiresAt, now);
    if (!bucket || days === null) return [];
    return [{
      lotId: row.lotId,
      batchNumber: row.batchNumber,
      expiresAt: row.expiresAt,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      genericItemId: row.genericItemId,
      itemName: row.itemName,
      quantity: safeStockNumber(row.quantity ?? 0),
      baseUnit: { code: row.unitCode, dimension: row.unitDimension, toBase: row.unitToBase },
      days,
      bucket,
    }];
  });

  return { thresholds, lowStock: thresholds.filter((row) => isLowStock(row.quantity, row.minimumQty)), expiringLots };
}
