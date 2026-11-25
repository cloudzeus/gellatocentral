import type { Category } from "../storage/rules";
import type { Permission } from "../permissions";

export const DOCUMENT_ENTITIES = ["purchase_order", "production_batch", "recipe", "haccp_monthly", "sales_document", "schedule_publication", "wholesale_quote"] as const;
export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];
export type DocumentFormat = "pdf" | "xlsx" | "csv" | "ics";

export type DocumentBrand = {
  name: string;
  legalName: string | null;
  vatNumber: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  labelExtraText: string | null;
};

export type DocumentSection = {
  title: string;
  paragraphs?: string[];
  fields?: { label: string; value: string }[];
  table?: { headers: string[]; rows: string[][] };
};

export type DocumentModel = {
  entityType: DocumentEntity;
  entityId: string;
  title: string;
  subtitle?: string;
  filename: string;
  brand: DocumentBrand;
  sections: DocumentSection[];
};

export type LoadedDocument = {
  model: DocumentModel;
  scope?: { storeId?: string; warehouseId?: string; warehouseIds?: readonly string[] };
  schedule?: { snapshot: unknown; version: number; fromAt: Date; toAt: Date };
};

export const DOCUMENT_CONFIG: Record<DocumentEntity, { permission: Permission; category: Category }> = {
  purchase_order: { permission: "orders.read", category: "generated_purchase_order" },
  production_batch: { permission: "production.read", category: "generated_production" },
  recipe: { permission: "recipes.read", category: "generated_recipe" },
  haccp_monthly: { permission: "haccp.read", category: "generated_haccp" },
  sales_document: { permission: "invoices.read", category: "generated_sales_document" },
  schedule_publication: { permission: "staff.read", category: "generated_schedule" },
  wholesale_quote: { permission: "wholesale.read", category: "generated_wholesale_quote" },
};

export function isDocumentEntity(value: string): value is DocumentEntity {
  return (DOCUMENT_ENTITIES as readonly string[]).includes(value);
}

export function documentFilename(model: Pick<DocumentModel, "filename">, extension: DocumentFormat) {
  const base = model.filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";
  return `${base}.${extension}`;
}
