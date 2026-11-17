import { saveCustomer } from "@/app/(app)/customers/actions";
import { Submit } from "./submit";
import { btn, Field } from "./ui";

type Values = { id: string; name: string; tradeName: string | null; vatNumber: string | null; taxOffice: string | null; profession: string | null; contactName: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; postalCode: string | null; paymentTermsDays: number | null; notes: string | null };

/** Η ίδια φόρμα για νέο πελάτη και για αλλαγή στοιχείων. Μόνο η επωνυμία είναι υποχρεωτική. */
export function CustomerForm({ customer }: { customer?: Values }) {
  const v = (k: keyof Values) => String(customer?.[k] ?? "");
  return (
    <form key={customer ? JSON.stringify(customer) : "new"} action={saveCustomer.bind(null, customer?.id ?? null)} className="grid gap-4 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>button]:sm:justify-self-end">
      <Field label="Επωνυμία ή ονοματεπώνυμο" name="name" required minLength={2} maxLength={160} defaultValue={v("name")} />
      <Field label="Διακριτικός τίτλος" name="tradeName" maxLength={160} defaultValue={v("tradeName")} hint="Όπως είναι γνωστό το κατάστημα" />
      <Field label="ΑΦΜ" name="vatNumber" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} defaultValue={v("vatNumber")} hint="9 ψηφία. Χρειάζεται για τιμολόγιο" />
      <Field label="ΔΟΥ" name="taxOffice" maxLength={80} defaultValue={v("taxOffice")} />
      <Field label="Επάγγελμα" name="profession" maxLength={120} defaultValue={v("profession")} />
      <Field label="Υπεύθυνος επικοινωνίας" name="contactName" maxLength={120} defaultValue={v("contactName")} />
      <Field label="Email" name="email" type="email" maxLength={160} defaultValue={v("email")} hint="Εδώ θα στέλνονται τα παραστατικά" />
      <Field label="Τηλέφωνο" name="phone" type="tel" maxLength={40} defaultValue={v("phone")} />
      <Field label="Διεύθυνση" name="address" maxLength={200} defaultValue={v("address")} />
      <Field label="Πόλη" name="city" maxLength={80} defaultValue={v("city")} />
      <Field label="Τ.Κ." name="postalCode" inputMode="numeric" maxLength={10} defaultValue={v("postalCode")} />
      <Field label="Ημέρες πίστωσης" name="paymentTermsDays" type="number" min={0} max={365} defaultValue={v("paymentTermsDays")} hint="Κενό = πληρωμή με την παράδοση" />
      <div className="sm:col-span-2"><Field label="Σημειώσεις" name="notes" maxLength={1000} defaultValue={v("notes")} /></div>
      <Submit className={btn("default")}>{customer ? "Αποθήκευση" : "Προσθήκη πελάτη"}</Submit>
    </form>
  );
}
