-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionPlanStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WholesaleOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DELIVERED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashClosingStatus" AS ENUM ('CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "StockHoldStatus" AS ENUM ('AVAILABLE', 'HELD', 'RELEASED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MigrationRunStatus" AS ENUM ('DRY_RUN', 'IMPORTED', 'ROLLED_BACK');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "externalSendingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "labelExtraText" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "mrpCoverDays" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "mrpSporadicDays" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "mrpUsageDays" INTEGER NOT NULL DEFAULT 28,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "taxOffice" TEXT;

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "creditLimitCents" INTEGER,
ADD COLUMN     "deliveryDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minOrderValueCents" INTEGER,
ADD COLUMN     "orderDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "destinationWarehouseId" TEXT,
ADD COLUMN     "expectedQuantityGrams" INTEGER,
ADD COLUMN     "labourCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "labourMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outputGenericItemId" TEXT,
ADD COLUMN     "outputLotId" TEXT,
ADD COLUMN     "recipeSnapshot" JSONB,
ADD COLUMN     "recipeVersionId" TEXT,
ADD COLUMN     "scrapReason" TEXT,
ADD COLUMN     "wasteGrams" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "outputGenericItemId" TEXT,
ADD COLUMN     "shelfLifeDays" INTEGER;

-- AlterTable
ALTER TABLE "StockLot" ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "holdStatus" "StockHoldStatus" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "productionBatchId" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "unitCostHundredths" INTEGER;

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "supplierItemId" TEXT,
    "orderedBaseQty" INTEGER NOT NULL,
    "receivedBaseQty" INTEGER NOT NULL DEFAULT 0,
    "packQty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "purchaseDocId" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "purchaseLineId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantityBase" INTEGER NOT NULL,
    "previousAvgCostHundredths" INTEGER NOT NULL,
    "resultingAvgCostHundredths" INTEGER NOT NULL,

    CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrpItemSetting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "genericItemId" TEXT NOT NULL,
    "supplierId" TEXT,
    "secondarySupplierId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "leadDays" INTEGER,
    "coverDays" INTEGER,
    "minimumBaseQty" INTEGER NOT NULL DEFAULT 0,
    "orderMultipleBase" INTEGER NOT NULL DEFAULT 1,
    "shelfLifeDays" INTEGER,
    "orderDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "deliveryDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MrpItemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "replyBy" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "quantityBase" INTEGER NOT NULL,
    "unitCode" TEXT NOT NULL,
    "awardedSupplierId" TEXT,

    CONSTRAINT "RfqLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqSupplier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "RfqSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqQuote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rfqSupplierId" TEXT NOT NULL,
    "rfqLineId" TEXT NOT NULL,
    "packagePriceCents" INTEGER,
    "unitsPerPackage" INTEGER,
    "unitPriceHundredths" INTEGER,
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RfqQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "capacityGrams" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineMaintenance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "recipeId" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "machineId" TEXT,
    "operatorEmployeeId" TEXT,
    "plannedFor" TIMESTAMP(3) NOT NULL,
    "quantityGrams" INTEGER NOT NULL,
    "status" "ProductionPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "batchId" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCorrection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "previousQuantityGrams" INTEGER NOT NULL,
    "correctedQuantityGrams" INTEGER NOT NULL,
    "deltaGrams" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaccpLotCheck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "batchId" TEXT,
    "kind" TEXT NOT NULL,
    "measuredValue" DOUBLE PRECISION,
    "unit" TEXT,
    "minimum" DOUBLE PRECISION,
    "maximum" DOUBLE PRECISION,
    "conforming" BOOLEAN NOT NULL,
    "notes" TEXT,
    "correctiveAction" TEXT,
    "checkedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaccpLotCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListParty" (
    "orgId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,

    CONSTRAINT "PriceListParty_pkey" PRIMARY KEY ("priceListId","partyId")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "WholesaleOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "neededAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "note" TEXT,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'backoffice',
    "externalKey" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleOrderLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "quantityBase" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,

    CONSTRAINT "WholesaleOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRoute" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "plannedFor" TIMESTAMP(3) NOT NULL,
    "driverName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryStop" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "recipientName" TEXT,
    "proofNote" TEXT,

    CONSTRAINT "DeliveryStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "seriesId" TEXT,
    "fiscalDocumentId" TEXT,
    "docType" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "aa" INTEGER NOT NULL,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "netCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocumentLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "genericItemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantityBase" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "costHundredths" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "accountId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPaymentAllocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "B2bAccess" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "B2bAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT,
    "storeId" TEXT,
    "warehouseId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePay" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payType" TEXT NOT NULL DEFAULT 'HOURLY',
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 0,
    "monthlySalaryCents" INTEGER NOT NULL DEFAULT 0,
    "iban" TEXT,
    "vatNumber" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT,
    "storeId" TEXT,
    "productionPlanId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRateCents" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulePublication" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "groupKind" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedByName" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulePublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLeave" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "acknowledgedVersion" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bank',
    "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "openingAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceTransaction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "transferId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "supplierId" TEXT,
    "category" TEXT NOT NULL,
    "documentNumber" TEXT,
    "netCents" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "informal" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "accountId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "informal" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "purchaseDocId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosing" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'DAY',
    "openingCashCents" INTEGER NOT NULL DEFAULT 0,
    "expectedCashCents" INTEGER NOT NULL,
    "actualCashCents" INTEGER NOT NULL,
    "cardCents" INTEGER NOT NULL DEFAULT 0,
    "platformCents" INTEGER NOT NULL DEFAULT 0,
    "payoutsCents" INTEGER NOT NULL DEFAULT 0,
    "commissionCents" INTEGER NOT NULL DEFAULT 0,
    "status" "CashClosingStatus" NOT NULL DEFAULT 'CLOSED',
    "reopenedReason" TEXT,
    "closedByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedAt" TIMESTAMP(3),

    CONSTRAINT "CashClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTarget" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "salesCents" INTEGER NOT NULL DEFAULT 0,
    "cogsCents" INTEGER NOT NULL DEFAULT 0,
    "payrollCents" INTEGER NOT NULL DEFAULT 0,
    "expenseCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BudgetTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitrineSetting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "selectionMode" TEXT NOT NULL DEFAULT 'manual',
    "warehouseId" TEXT,
    "languages" TEXT[] DEFAULT ARRAY['el', 'en', 'it']::TEXT[],
    "showPrices" BOOLEAN NOT NULL DEFAULT true,
    "showAllergens" BOOLEAN NOT NULL DEFAULT true,
    "tvPageSeconds" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VitrineSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitrineItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "genericItemId" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "VitrineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitrineDailyView" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "viewedOn" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VitrineDailyView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'el',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Athens',
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "alertTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "MigrationRunStatus" NOT NULL DEFAULT 'DRY_RUN',
    "summary" JSONB NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "localId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_orgId_supplierId_status_expectedAt_idx" ON "PurchaseOrder"("orgId", "supplierId", "status", "expectedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orgId_warehouseId_status_idx" ON "PurchaseOrder"("orgId", "warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orgId_number_key" ON "PurchaseOrder"("orgId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orgId_genericItemId_orderId_idx" ON "PurchaseOrderLine"("orgId", "genericItemId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_orderId_genericItemId_key" ON "PurchaseOrderLine"("orderId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_purchaseDocId_key" ON "PurchaseReceipt"("purchaseDocId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_orgId_orderId_createdAt_idx" ON "PurchaseReceipt"("orgId", "orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptLine_purchaseLineId_key" ON "PurchaseReceiptLine"("purchaseLineId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptLine_orgId_genericItemId_receiptId_idx" ON "PurchaseReceiptLine"("orgId", "genericItemId", "receiptId");

-- CreateIndex
CREATE INDEX "MrpItemSetting_orgId_supplierId_idx" ON "MrpItemSetting"("orgId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "MrpItemSetting_orgId_warehouseId_genericItemId_key" ON "MrpItemSetting"("orgId", "warehouseId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_orgId_number_key" ON "Rfq"("orgId", "number");

-- CreateIndex
CREATE INDEX "RfqLine_orgId_genericItemId_idx" ON "RfqLine"("orgId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqLine_rfqId_genericItemId_key" ON "RfqLine"("rfqId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqSupplier_tokenHash_key" ON "RfqSupplier"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RfqSupplier_rfqId_supplierId_key" ON "RfqSupplier"("rfqId", "supplierId");

-- CreateIndex
CREATE INDEX "RfqQuote_orgId_rfqLineId_idx" ON "RfqQuote"("orgId", "rfqLineId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqQuote_rfqSupplierId_rfqLineId_key" ON "RfqQuote"("rfqSupplierId", "rfqLineId");

-- CreateIndex
CREATE INDEX "DocumentDelivery_orgId_entityType_entityId_createdAt_idx" ON "DocumentDelivery"("orgId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDelivery_orgId_entityType_entityId_channel_recipien_key" ON "DocumentDelivery"("orgId", "entityType", "entityId", "channel", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_orgId_code_key" ON "Machine"("orgId", "code");

-- CreateIndex
CREATE INDEX "MachineMaintenance_orgId_nextDueAt_idx" ON "MachineMaintenance"("orgId", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_orgId_recipeId_version_key" ON "RecipeVersion"("orgId", "recipeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPlan_batchId_key" ON "ProductionPlan"("batchId");

-- CreateIndex
CREATE INDEX "ProductionPlan_orgId_plannedFor_status_idx" ON "ProductionPlan"("orgId", "plannedFor", "status");

-- CreateIndex
CREATE INDEX "ProductionPlan_orgId_sourceWarehouseId_status_idx" ON "ProductionPlan"("orgId", "sourceWarehouseId", "status");

-- CreateIndex
CREATE INDEX "ProductionCorrection_orgId_batchId_createdAt_idx" ON "ProductionCorrection"("orgId", "batchId", "createdAt");

-- CreateIndex
CREATE INDEX "HaccpLotCheck_orgId_lotId_createdAt_idx" ON "HaccpLotCheck"("orgId", "lotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_orgId_name_key" ON "PriceList"("orgId", "name");

-- CreateIndex
CREATE INDEX "PriceListParty_orgId_partyId_idx" ON "PriceListParty"("orgId", "partyId");

-- CreateIndex
CREATE INDEX "PriceListItem_orgId_genericItemId_idx" ON "PriceListItem"("orgId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_genericItemId_key" ON "PriceListItem"("priceListId", "genericItemId");

-- CreateIndex
CREATE INDEX "WholesaleOrder_orgId_customerId_status_neededAt_idx" ON "WholesaleOrder"("orgId", "customerId", "status", "neededAt");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleOrder_orgId_number_key" ON "WholesaleOrder"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleOrder_orgId_source_externalKey_key" ON "WholesaleOrder"("orgId", "source", "externalKey");

-- CreateIndex
CREATE INDEX "WholesaleOrderLine_orgId_genericItemId_idx" ON "WholesaleOrderLine"("orgId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleOrderLine_orderId_genericItemId_key" ON "WholesaleOrderLine"("orderId", "genericItemId");

-- CreateIndex
CREATE INDEX "DeliveryRoute_orgId_plannedFor_status_idx" ON "DeliveryRoute"("orgId", "plannedFor", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryStop_orderId_key" ON "DeliveryStop"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryStop_orgId_orderId_idx" ON "DeliveryStop"("orgId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryStop_routeId_position_key" ON "DeliveryStop"("routeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_fiscalDocumentId_key" ON "SalesDocument"("fiscalDocumentId");

-- CreateIndex
CREATE INDEX "SalesDocument_orgId_customerId_status_dueAt_idx" ON "SalesDocument"("orgId", "customerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "SalesDocument_orgId_orderId_status_idx" ON "SalesDocument"("orgId", "orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_orgId_docType_series_aa_key" ON "SalesDocument"("orgId", "docType", "series", "aa");

-- CreateIndex
CREATE INDEX "SalesDocumentLine_orgId_genericItemId_idx" ON "SalesDocumentLine"("orgId", "genericItemId");

-- CreateIndex
CREATE INDEX "CustomerPayment_orgId_customerId_paidAt_idx" ON "CustomerPayment"("orgId", "customerId", "paidAt");

-- CreateIndex
CREATE INDEX "CustomerPaymentAllocation_orgId_documentId_idx" ON "CustomerPaymentAllocation"("orgId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentAllocation_paymentId_documentId_key" ON "CustomerPaymentAllocation"("paymentId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "B2bAccess_tokenHash_key" ON "B2bAccess"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "B2bAccess_orgId_customerId_key" ON "B2bAccess"("orgId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_name_key" ON "Department"("orgId", "name");

-- CreateIndex
CREATE INDEX "Employee_orgId_active_departmentId_idx" ON "Employee"("orgId", "active", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePay_employeeId_key" ON "EmployeePay"("employeeId");

-- CreateIndex
CREATE INDEX "Shift_orgId_startsAt_endsAt_idx" ON "Shift"("orgId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Shift_orgId_employeeId_startsAt_idx" ON "Shift"("orgId", "employeeId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePublication_orgId_storeId_groupKind_fromAt_toAt_ver_key" ON "SchedulePublication"("orgId", "storeId", "groupKind", "fromAt", "toAt", "version");

-- CreateIndex
CREATE INDEX "EmployeeLeave_orgId_employeeId_fromAt_toAt_idx" ON "EmployeeLeave"("orgId", "employeeId", "fromAt", "toAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleLink_employeeId_key" ON "ScheduleLink"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleLink_tokenHash_key" ON "ScheduleLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAccount_orgId_name_key" ON "FinanceAccount"("orgId", "name");

-- CreateIndex
CREATE INDEX "FinanceTransaction_orgId_occurredAt_idx" ON "FinanceTransaction"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "FinanceTransaction_orgId_transferId_idx" ON "FinanceTransaction"("orgId", "transferId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceTransaction_orgId_accountId_referenceType_referenceI_key" ON "FinanceTransaction"("orgId", "accountId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Expense_orgId_category_occurredAt_idx" ON "Expense"("orgId", "category", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_orgId_supplierId_documentNumber_key" ON "Expense"("orgId", "supplierId", "documentNumber");

-- CreateIndex
CREATE INDEX "SupplierPayment_orgId_supplierId_paidAt_idx" ON "SupplierPayment"("orgId", "supplierId", "paidAt");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_orgId_purchaseDocId_idx" ON "SupplierPaymentAllocation"("orgId", "purchaseDocId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentAllocation_paymentId_purchaseDocId_key" ON "SupplierPaymentAllocation"("paymentId", "purchaseDocId");

-- CreateIndex
CREATE INDEX "CashClosing_orgId_businessDate_status_idx" ON "CashClosing"("orgId", "businessDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashClosing_orgId_storeId_businessDate_shift_key" ON "CashClosing"("orgId", "storeId", "businessDate", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTarget_orgId_storeId_year_month_key" ON "BudgetTarget"("orgId", "storeId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "VitrineSetting_storeId_key" ON "VitrineSetting"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "VitrineSetting_tokenHash_key" ON "VitrineSetting"("tokenHash");

-- CreateIndex
CREATE INDEX "VitrineItem_orgId_genericItemId_idx" ON "VitrineItem"("orgId", "genericItemId");

-- CreateIndex
CREATE UNIQUE INDEX "VitrineItem_settingId_productId_key" ON "VitrineItem"("settingId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VitrineDailyView_orgId_storeId_viewedOn_key" ON "VitrineDailyView"("orgId", "storeId", "viewedOn");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "MigrationRun_orgId_createdAt_idx" ON "MigrationRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MigrationRecord_orgId_runId_status_idx" ON "MigrationRecord"("orgId", "runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationRecord_orgId_entityType_externalId_key" ON "MigrationRecord"("orgId", "entityType", "externalId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MrpItemSetting" ADD CONSTRAINT "MrpItemSetting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqSupplier" ADD CONSTRAINT "RfqSupplier_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqQuote" ADD CONSTRAINT "RfqQuote_rfqSupplierId_fkey" FOREIGN KEY ("rfqSupplierId") REFERENCES "RfqSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDelivery" ADD CONSTRAINT "DocumentDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineMaintenance" ADD CONSTRAINT "MachineMaintenance_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCorrection" ADD CONSTRAINT "ProductionCorrection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaccpLotCheck" ADD CONSTRAINT "HaccpLotCheck_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListParty" ADD CONSTRAINT "PriceListParty_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleOrderLine" ADD CONSTRAINT "WholesaleOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WholesaleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRoute" ADD CONSTRAINT "DeliveryRoute_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStop" ADD CONSTRAINT "DeliveryStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WholesaleOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SalesDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CustomerPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SalesDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "B2bAccess" ADD CONSTRAINT "B2bAccess_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePay" ADD CONSTRAINT "EmployeePay_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePay" ADD CONSTRAINT "EmployeePay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulePublication" ADD CONSTRAINT "SchedulePublication_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleLink" ADD CONSTRAINT "ScheduleLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleLink" ADD CONSTRAINT "ScheduleLink_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosing" ADD CONSTRAINT "CashClosing_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTarget" ADD CONSTRAINT "BudgetTarget_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitrineSetting" ADD CONSTRAINT "VitrineSetting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitrineItem" ADD CONSTRAINT "VitrineItem_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "VitrineSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitrineDailyView" ADD CONSTRAINT "VitrineDailyView_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Nullable composite unique keys στο PostgreSQL: κλείδωμα και των global γραμμών.
CREATE UNIQUE INDEX "MrpItemSetting_global_item_key" ON "MrpItemSetting"("orgId", "genericItemId") WHERE "warehouseId" IS NULL;
CREATE UNIQUE INDEX "BudgetTarget_global_month_key" ON "BudgetTarget"("orgId", "year", "month") WHERE "storeId" IS NULL;
CREATE UNIQUE INDEX "SchedulePublication_global_version_key" ON "SchedulePublication"("orgId", "groupKind", "fromAt", "toAt", "version") WHERE "storeId" IS NULL;
CREATE UNIQUE INDEX "Expense_global_document_key" ON "Expense"("orgId", "documentNumber") WHERE "supplierId" IS NULL AND "documentNumber" IS NOT NULL;
CREATE UNIQUE INDEX "FinanceTransaction_global_reference_key" ON "FinanceTransaction"("orgId", "accountId", "referenceType", "referenceId") WHERE "referenceType" IS NOT NULL AND "referenceId" IS NOT NULL;

-- Επιχειρησιακά αδιέξοδα αποκλείονται και από τη βάση, όχι μόνο από validation.
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_quantities_check" CHECK ("orderedBaseQty" > 0 AND "receivedBaseQty" >= 0 AND "receivedBaseQty" <= "orderedBaseQty" AND "packQty" > 0 AND "unitPriceCents" >= 0 AND "discountBps" BETWEEN 0 AND 10000);
ALTER TABLE "MrpItemSetting" ADD CONSTRAINT "MrpItemSetting_values_check" CHECK ("minimumBaseQty" >= 0 AND "orderMultipleBase" > 0);
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_quantity_check" CHECK ("quantityGrams" > 0);
ALTER TABLE "WholesaleOrderLine" ADD CONSTRAINT "WholesaleOrderLine_values_check" CHECK ("quantityBase" > 0 AND "unitPriceCents" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_period_check" CHECK ("endsAt" > "startsAt" AND "breakMinutes" >= 0);
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_period_check" CHECK ("toAt" >= "fromAt");
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_amount_check" CHECK ("amountCents" <> 0);
ALTER TABLE "CashClosing" ADD CONSTRAINT "CashClosing_values_check" CHECK ("actualCashCents" >= 0 AND "openingCashCents" >= 0);
ALTER TABLE "BudgetTarget" ADD CONSTRAINT "BudgetTarget_period_check" CHECK ("year" BETWEEN 2000 AND 2200 AND "month" BETWEEN 1 AND 12);
ALTER TABLE "VitrineSetting" ADD CONSTRAINT "VitrineSetting_page_seconds_check" CHECK ("tvPageSeconds" BETWEEN 3 AND 300);
