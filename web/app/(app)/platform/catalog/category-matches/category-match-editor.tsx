"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { SearchSelect } from "@/components/search-select";
import { btn } from "@/components/ui";
import type { SelectOption } from "@/lib/select-options";
import { updateCatalogItemClassification, updateCategoryMatchItem } from "../actions";

export type CategoryMatchBrandOption = [id: string, name: string, manufacturerId: string];

/** Η σχέση είδους ↔ brand αλλάζει τοπικά· δεν μετακινείται το ίδιο το brand σε άλλον κατασκευαστή. */
export function CategoryMatchEditor({ itemId, categoryId, manufacturerId, brandId, categoryOptions, manufacturerOptions, brandOptions, existingCategory = false }: {
  itemId: string;
  categoryId: string;
  manufacturerId: string;
  brandId: string;
  categoryOptions: SelectOption[];
  manufacturerOptions: SelectOption[];
  brandOptions: CategoryMatchBrandOption[];
  /** Στον κύριο κατάλογο επιτρέπεται η αλλαγή ήδη ταξινομημένου είδους. */
  existingCategory?: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(categoryId);
  const [manufacturer, setManufacturer] = useState(manufacturerId);
  const [brand, setBrand] = useState(brandId);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startSave] = useTransition();
  const availableBrands = brandOptions.filter(([, , id]) => id === manufacturer);

  const changed = () => {
    setError(null);
    setSaved(false);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    changed();
    startSave(async () => {
      try {
        const update = existingCategory ? updateCatalogItemClassification : updateCategoryMatchItem;
        const result = await update({ itemId, categoryId: category, manufacturerId: manufacturer, brandId: brand });
        if (result) setError(result);
        else {
          setSaved(true);
          router.refresh();
        }
      } catch {
        setError("Η αποθήκευση απέτυχε. Δοκίμασε ξανά");
      }
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="border-b border-border/70 bg-secondary/25 px-5 py-4">
        <h3 className="text-sm font-semibold">Διόρθωση κατηγορίας & προέλευσης</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Οι αλλαγές εφαρμόζονται μόνο σε αυτό το είδος. Για κατασκευαστή χρειάζεται και το αντίστοιχο brand.</p>
      </div>
      <form onSubmit={submit} className="grid gap-5 p-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold">Κατηγορία <span className="text-destructive">*</span></span>
            <SearchSelect name="categoryId" value={category} options={categoryOptions} onValueChange={(value) => { setCategory(value); changed(); }} required ariaLabel="Κατηγορία είδους" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold">Κατασκευαστής</span>
            <SearchSelect name="manufacturerId" value={manufacturer} options={[["", "— Χωρίς κατασκευαστή —"], ...manufacturerOptions]} onValueChange={(value) => { setManufacturer(value); setBrand(""); changed(); }} ariaLabel="Κατασκευαστής είδους" />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold">Brand {manufacturer ? <span className="text-destructive">*</span> : null}</span>
            <SearchSelect name="brandId" value={brand} options={[["", manufacturer ? "Επιλογή brand…" : "Διάλεξε πρώτα κατασκευαστή"], ...availableBrands.map(([id, name]): SelectOption => [id, name])]} onValueChange={(value) => { setBrand(value); changed(); }} required={!!manufacturer} disabled={!manufacturer} ariaLabel="Brand είδους" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
          <div aria-live="polite" className="min-h-5 text-xs">
            {error ? <p role="alert" className="font-medium text-destructive">{error}</p> : saved ? <p role="status" className="font-medium text-success-ink">Η διόρθωση αποθηκεύτηκε.</p> : <p className="text-muted-foreground">Η κατηγορία ελέγχεται ξανά στον server πριν από την εγγραφή.</p>}
          </div>
          <button type="submit" disabled={pending || !category || (!!manufacturer && !brand)} aria-busy={pending || undefined} className={btn("default", "sm")}>
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Save />}
            {pending ? "Αποθήκευση…" : "Αποθήκευση διόρθωσης"}
          </button>
        </div>
      </form>
    </section>
  );
}
