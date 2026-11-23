import { Submit } from "@/components/submit";
import { btn, Card, Field, Select, TextareaField } from "@/components/ui";
import { HACCP_FORMS } from "@/lib/haccp/forms";

export type HaccpRecordFormValue = { templateId: string; storeId: string | null; occurredAt: string; status: string; result: string; measuredValue: number | null; unit: string | null; responsibleName: string; notes: string | null; correctiveAction: string | null };
export function HaccpRecordForm({ action, stores, value }: { action: (form: FormData) => Promise<void>; stores: { id: string; name: string }[]; value: HaccpRecordFormValue }) {
  return <Card><form action={action} className="grid gap-5 px-5 py-5">
    <div className="grid gap-4 md:grid-cols-2">
      <Select label="Έντυπο / διαδικασία" name="templateId" required defaultValue={value.templateId} options={HACCP_FORMS.map((item): [string, string] => [item.id, `${item.category} — ${item.title}`])} />
      <Select label="Κατάστημα" name="storeId" defaultValue={value.storeId ?? ""} options={[["", "Όλη η επιχείρηση"], ...stores.map((store): [string, string] => [store.id, store.name])]} hint="Η επιλογή «όλη» διατίθεται μόνο σε χρήστες χωρίς περιορισμό καταστημάτων." />
      <Field label="Ημερομηνία και ώρα" name="occurredAt" type="datetime-local" required defaultValue={value.occurredAt} />
      <Field label="Υπεύθυνος" name="responsibleName" required minLength={2} maxLength={120} defaultValue={value.responsibleName} />
      <Select label="Κατάσταση" name="status" defaultValue={value.status} options={[["DRAFT", "Πρόχειρο"], ["COMPLETED", "Ολοκληρωμένο"]]} />
      <Select label="Αποτέλεσμα" name="result" defaultValue={value.result} options={[["CONFORMING", "Συμμορφούμενο"], ["DEVIATION", "Απόκλιση"], ["NA", "Δεν εφαρμόζεται"]]} />
      <Field label="Μετρηθείσα τιμή (προαιρετικά)" name="measuredValue" type="number" step="any" defaultValue={value.measuredValue ?? ""} />
      <Field label="Μονάδα" name="unit" maxLength={20} defaultValue={value.unit ?? ""} placeholder="π.χ. °C, λεπτά" />
    </div>
    <TextareaField label="Παρατηρήσεις / αποδεικτικό" name="notes" rows={4} maxLength={4000} defaultValue={value.notes ?? ""} placeholder="Πραγματικές παρατηρήσεις, παρτίδα, αναφορά σε αρχείο ή πιστοποιητικό…" />
    <TextareaField label="Διορθωτική ενέργεια" name="correctiveAction" rows={4} maxLength={4000} defaultValue={value.correctiveAction ?? ""} hint="Σε απόκλιση: έλεγχος, επηρεαζόμενο προϊόν, διάθεση και πρόληψη επανάληψης." />
    <div className="flex justify-end"><Submit className={btn("default")} pendingText="Αποθήκευση…">Αποθήκευση καταχώρισης</Submit></div>
  </form></Card>;
}
