// Φόρμα είδους του κεντρικού καταλόγου — κοινή για «Νέο είδος», το modal της λίστας και την καρτέλα είδους.
// Η φωτογραφία μένει στην καρτέλα. Στη λίστα φορτώνεται μία φόρμα μόνο για το επιλεγμένο είδος,
// ώστε να μην επαναλαμβάνονται τα πολυάριθμα options και τα queries ανά γραμμή.
import { BarcodeField } from "@/components/barcode-field";
import { Files } from "@/components/files";
import { Submit } from "@/components/submit";
import { btn, Field, Select } from "@/components/ui";
import { saveTradeItem } from "./actions";

export type CatalogFormItem = {
  id: string;
  name: string;
  ean: string | null;
  categoryId: string | null;
  brandId: string | null;
  packaging: string | null;
  familyCode: string | null;
  contentQty: number;
  contentUnitId: string;
  contentUnit: { toBase: number };
};

type Props = {
  item?: CatalogFormItem;
  categoryOptions: [string, string][];
  brandOptions: [string, string][];
  units: { id: string; nameEL: string }[];
  /** Στη λίστα δεν φορτώνουμε Files ανά γραμμή· η φωτογραφία μένει στην καρτέλα. */
  withFiles?: boolean;
  returnTo?: "catalog";
};

export function ItemForm({ item: t, categoryOptions, brandOptions, units, withFiles = true, returnTo }: Props) {
  return (
    <form action={saveTradeItem} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="itemId" value={t?.id ?? ""} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <Field label="Όνομα" name="name" required minLength={2} maxLength={80} defaultValue={t?.name} hint="π.χ. Γάλα φρέσκο 1,5% 1L" />
      <BarcodeField label="EAN / GTIN" name="ean" defaultValue={t?.ean ?? ""} hint="Σάρωση ή 8–14 ψηφία — μοναδικό στον κεντρικό κατάλογο" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Κατηγορία" name="categoryId" defaultValue={t?.categoryId ?? ""} options={[["", "—"] as [string, string], ...categoryOptions]} />
        <Select label="Brand" name="brandId" defaultValue={t?.brandId ?? ""} options={[["", "—"], ...brandOptions]} />
      </div>
      <Field label="Συσκευασία" name="packaging" maxLength={80} defaultValue={t?.packaging ?? ""} hint="π.χ. χαρτοκιβώτιο, πλαστικό μπουκάλι" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Περιεχόμενο" name="contentAmount" required inputMode="decimal" defaultValue={t ? String(t.contentQty / t.contentUnit.toBase).replace(".", ",") : ""} hint="Στη μονάδα δίπλα, π.χ. 1,5" />
        <Select label="Μονάδα" name="contentUnitId" defaultValue={t?.contentUnitId ?? ""} options={units.map((u): [string, string] => [u.id, u.nameEL])} />
      </div>
      <Field label="Οικογένεια" name="familyCode" maxLength={40} defaultValue={t?.familyCode ?? ""} hint="π.χ. DELTA-GA-1.5 — ομαδοποιεί το ίδιο είδος σε 1L, 1,5L…" />
      <Submit className={btn("default")}>{t ? "Αποθήκευση" : "Προσθήκη"}</Submit>
      {t && withFiles ? (
        <div className="border-t border-border/70 pt-4">
          <p className="mb-2 text-sm font-medium">Φωτογραφία</p>
          <Files orgId={null} category="trade_item" refType="tradeItem" refId={t.id} empty="Καμία φωτογραφία ακόμα" />
        </div>
      ) : null}
    </form>
  );
}
