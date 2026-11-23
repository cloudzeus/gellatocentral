// Read-only ερωτήματα αποθέματος. Aggregation, FEFO ordering και pagination γίνονται στην PostgreSQL.
import { Prisma } from "./generated/prisma/client.ts";
import { safeStockNumber } from "./stock-view.ts";

export type StockReadDb = Pick<Prisma.TransactionClient, "$queryRaw" | "stockLot">;

export type StockReadInput = {
  orgId: string;
  warehouseIds: readonly string[]; // [] = καμία επιτρεπτή αποθήκη, ποτέ «όλες»
  q?: string;
  skip: number;
  take: number;
  sort?: "item" | "warehouse" | "quantity" | "cost" | "value" | "batch" | "expiresAt";
  dir?: "asc" | "desc";
};

export type StockUnitView = { code: string; dimension: string; toBase: number };
export type StockOverviewRow = {
  warehouseId: string;
  warehouseName: string;
  genericItemId: string;
  itemName: string;
  quantity: number;
  unitCostHundredths: number;
  valueHundredths: number;
  baseUnit: StockUnitView;
};

type OverviewSqlRow = {
  warehouseId: string | null;
  warehouseName: string | null;
  genericItemId: string | null;
  itemName: string | null;
  quantity: bigint | null;
  unitCostHundredths: number | null;
  valueHundredths: bigint | null;
  unitCode: string | null;
  unitDimension: string | null;
  unitToBase: number | null;
  total: bigint;
  totalValueHundredths: bigint;
};

const EMPTY_OVERVIEW = { rows: [], total: 0, totalValueHundredths: 0 };

// Μόνο allow-listed SQL· τιμές από το URL δεν συνενώνονται ποτέ απευθείας σε ερώτημα.
function overviewOrder(input: StockReadInput) {
  const column = { item: Prisma.sql`"itemName"`, warehouse: Prisma.sql`"warehouseName"`, quantity: Prisma.sql`"quantity"`, cost: Prisma.sql`"unitCostHundredths"`, value: Prisma.sql`"valueHundredths"` }[input.sort as "item" | "warehouse" | "quantity" | "cost" | "value"] ?? Prisma.sql`"itemName"`;
  const direction = input.dir === "desc" && input.sort ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  return Prisma.sql`${column} ${direction}, "warehouseName" ASC, "warehouseId" ASC, "genericItemId" ASC`;
}

function lotOrder(input: StockReadInput) {
  if (!input.sort) return Prisma.sql`"expiresAt" ASC NULLS LAST, "lotId" ASC`;
  const column = { batch: Prisma.sql`"batchNumber"`, item: Prisma.sql`"itemName"`, warehouse: Prisma.sql`"warehouseName"`, quantity: Prisma.sql`"quantity"`, expiresAt: Prisma.sql`"expiresAt"` }[input.sort as "batch" | "item" | "warehouse" | "quantity" | "expiresAt"] ?? Prisma.sql`"expiresAt"`;
  return Prisma.sql`${column} ${input.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`} NULLS LAST, "lotId" ASC`;
}

/** Συγκεντρωτικό on-hand ανά είδος/αποθήκη, χωρίς ψεύτικη στήλη δεσμευμένου. */
export async function stockOverview(tx: Pick<StockReadDb, "$queryRaw">, input: StockReadInput) {
  if (!input.warehouseIds.length) return EMPTY_OVERVIEW;
  const q = input.q?.trim() ?? "";
  const rows = await tx.$queryRaw<OverviewSqlRow[]>(Prisma.sql`
    WITH aggregated AS (
      SELECT
        m."warehouseId", w."name" AS "warehouseName",
        m."genericItemId", gi."name" AS "itemName",
        SUM(m."quantity")::bigint AS quantity,
        gi."avgCostHundredths" AS "unitCostHundredths",
        ROUND(SUM(m."quantity"::numeric * gi."avgCostHundredths"::numeric) / CASE u."dimension" WHEN 'mass' THEN 1000000 ELSE 1000 END)::bigint AS "valueHundredths",
        u."code" AS "unitCode", u."dimension" AS "unitDimension", u."toBase" AS "unitToBase"
      FROM "StockMovement" m
      JOIN "GenericItem" gi ON gi."id" = m."genericItemId" AND gi."orgId" = m."orgId"
      JOIN "Warehouse" w ON w."id" = m."warehouseId" AND w."orgId" = m."orgId"
      JOIN "Unit" u ON u."id" = gi."baseUnitId"
      WHERE m."orgId" = ${input.orgId}
        AND m."genericItemId" IS NOT NULL
        AND gi."trackStock" = TRUE
        AND m."warehouseId" IN (${Prisma.join(input.warehouseIds)})
        AND (${q} = '' OR STRPOS(LOWER(gi."name"), LOWER(${q})) > 0)
      GROUP BY m."warehouseId", w."name", m."genericItemId", gi."name", gi."avgCostHundredths", u."code", u."dimension", u."toBase"
      HAVING SUM(m."quantity") <> 0
    ), summary AS (
      SELECT COUNT(*)::bigint AS total, COALESCE(SUM("valueHundredths"), 0)::bigint AS "totalValueHundredths"
      FROM aggregated
    ), page AS (
      SELECT * FROM aggregated
      ORDER BY ${overviewOrder(input)}
      LIMIT ${input.take} OFFSET ${input.skip}
    )
    SELECT page.*, summary.total, summary."totalValueHundredths"
    FROM summary LEFT JOIN page ON TRUE
  `);
  const first = rows[0];
  return {
    rows: rows.flatMap((row): StockOverviewRow[] => {
      if (!row.warehouseId || !row.warehouseName || !row.genericItemId || !row.itemName || row.quantity === null || row.unitCostHundredths === null || row.valueHundredths === null || !row.unitCode || !row.unitDimension || row.unitToBase === null) return [];
      return [{
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        genericItemId: row.genericItemId,
        itemName: row.itemName,
        quantity: safeStockNumber(row.quantity),
        unitCostHundredths: row.unitCostHundredths,
        valueHundredths: safeStockNumber(row.valueHundredths),
        baseUnit: { code: row.unitCode, dimension: row.unitDimension, toBase: row.unitToBase },
      }];
    }),
    total: safeStockNumber(first?.total ?? 0),
    totalValueHundredths: safeStockNumber(first?.totalValueHundredths ?? 0),
  };
}

export type StockLotViewRow = {
  lotId: string;
  batchNumber: string | null;
  expiresAt: Date | null;
  warehouseId: string;
  warehouseName: string;
  genericItemId: string;
  itemName: string;
  quantity: number;
  baseUnit: StockUnitView;
};

type LotSqlRow = {
  lotId: string | null;
  batchNumber: string | null;
  expiresAt: Date | null;
  warehouseId: string | null;
  warehouseName: string | null;
  genericItemId: string | null;
  itemName: string | null;
  quantity: bigint | null;
  unitCode: string | null;
  unitDimension: string | null;
  unitToBase: number | null;
  total: bigint;
};

/** Ανοιχτές παρτίδες με θετικό υπόλοιπο· νωρίτερη λήξη πρώτη, null τελευταία, σταθερό lot id στην ισοπαλία. */
export async function stockLotBalances(tx: Pick<StockReadDb, "$queryRaw">, input: StockReadInput) {
  if (!input.warehouseIds.length) return { rows: [], total: 0 };
  const q = input.q?.trim() ?? "";
  const rows = await tx.$queryRaw<LotSqlRow[]>(Prisma.sql`
    WITH aggregated AS (
      SELECT
        l."id" AS "lotId", l."batchNumber", l."expiresAt",
        l."warehouseId", w."name" AS "warehouseName",
        l."genericItemId", gi."name" AS "itemName",
        SUM(m."quantity")::bigint AS quantity,
        u."code" AS "unitCode", u."dimension" AS "unitDimension", u."toBase" AS "unitToBase"
      FROM "StockMovement" m
      JOIN "StockLot" l ON l."id" = m."lotId" AND l."orgId" = m."orgId"
        AND l."genericItemId" = m."genericItemId" AND l."warehouseId" = m."warehouseId"
      JOIN "GenericItem" gi ON gi."id" = l."genericItemId" AND gi."orgId" = l."orgId"
      JOIN "Warehouse" w ON w."id" = l."warehouseId" AND w."orgId" = l."orgId"
      JOIN "Unit" u ON u."id" = gi."baseUnitId"
      WHERE m."orgId" = ${input.orgId}
        AND gi."trackStock" = TRUE
        AND m."warehouseId" IN (${Prisma.join(input.warehouseIds)})
        AND (${q} = '' OR STRPOS(LOWER(gi."name"), LOWER(${q})) > 0 OR STRPOS(LOWER(COALESCE(l."batchNumber", '')), LOWER(${q})) > 0)
      GROUP BY l."id", l."batchNumber", l."expiresAt", l."warehouseId", w."name", l."genericItemId", gi."name", u."code", u."dimension", u."toBase"
      HAVING SUM(m."quantity") > 0
    ), summary AS (
      SELECT COUNT(*)::bigint AS total FROM aggregated
    ), page AS (
      SELECT * FROM aggregated
      ORDER BY ${lotOrder(input)}
      LIMIT ${input.take} OFFSET ${input.skip}
    )
    SELECT page.*, summary.total FROM summary LEFT JOIN page ON TRUE
  `);
  return {
    rows: rows.flatMap((row): StockLotViewRow[] => {
      if (!row.lotId || !row.warehouseId || !row.warehouseName || !row.genericItemId || !row.itemName || row.quantity === null || !row.unitCode || !row.unitDimension || row.unitToBase === null) return [];
      return [{
        lotId: row.lotId,
        batchNumber: row.batchNumber,
        expiresAt: row.expiresAt,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouseName,
        genericItemId: row.genericItemId,
        itemName: row.itemName,
        quantity: safeStockNumber(row.quantity),
        baseUnit: { code: row.unitCode, dimension: row.unitDimension, toBase: row.unitToBase },
      }];
    }),
    total: safeStockNumber(rows[0]?.total ?? 0),
  };
}

/** Λεπτομέρεια παρτίδας μόνο εντός tenant και ρητά επιτρεπόμενων warehouses. */
export async function scopedStockLot(tx: Pick<StockReadDb, "stockLot">, input: { orgId: string; warehouseIds: readonly string[]; lotId: string }) {
  if (!input.warehouseIds.length) return null;
  return tx.stockLot.findFirst({
    where: { id: input.lotId, orgId: input.orgId, warehouseId: { in: [...input.warehouseIds] } },
    include: {
      genericItem: { include: { baseUnit: true } },
      warehouse: { select: { id: true, name: true } },
      document: { select: { id: true, number: true, issuedAt: true, supplier: { select: { id: true, name: true } } } },
    },
  });
}
