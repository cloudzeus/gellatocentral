import { Save } from "lucide-react";
import { Submit } from "@/components/submit";
import { btn, Card, Field, Page, TextareaField } from "@/components/ui";
import { db } from "@/lib/db";
import { requireStockContext } from "@/lib/stock-context";
import { saveCompany } from "./actions";

export default async function CompanyPage({ searchParams }: PageProps<"/company">) {
  const ctx = await requireStockContext("users.edit");
  const query = await searchParams;
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const restricted = ctx.storeIds.length > 0 || ctx.warehouseIds.length > 0;
  return <Page section="Ρυθμίσεις" title="Στοιχεία επιχείρησης" description="Νομικά στοιχεία, επικοινωνία και στοιχεία εκτύπωσης του τρέχοντος tenant">
    <form action={saveCompany} className="grid max-w-5xl gap-5">
      {typeof query.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{query.error}</p> : null}
      {typeof query.saved === "string" ? <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success-ink">{query.saved}</p> : null}
      {restricted ? <p role="alert" className="rounded-lg bg-gold/15 p-3 text-sm text-gold-ink">Η επεξεργασία απαιτεί πρόσβαση σε όλα τα καταστήματα και αποθήκες.</p> : null}
      <Card className="grid gap-4 p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Νομικά στοιχεία</h2><Field label="Όνομα εφαρμογής" name="name" defaultValue={org.name} required maxLength={120} disabled={restricted} /><Field label="Επωνυμία" name="legalName" defaultValue={org.legalName ?? ""} maxLength={180} disabled={restricted} /><Field label="ΑΦΜ" name="vatNumber" defaultValue={org.vatNumber} required maxLength={30} disabled={restricted} /><Field label="ΔΟΥ" name="taxOffice" defaultValue={org.taxOffice ?? ""} maxLength={100} disabled={restricted} /><Field label="Διεύθυνση" name="address" defaultValue={org.address ?? ""} maxLength={200} disabled={restricted} /><Field label="Πόλη" name="city" defaultValue={org.city ?? ""} maxLength={100} disabled={restricted} /><Field label="Ταχυδρομικός κώδικας" name="postalCode" defaultValue={org.postalCode ?? ""} maxLength={20} disabled={restricted} /><Field label="Τηλέφωνο" name="phone" defaultValue={org.phone ?? ""} maxLength={40} disabled={restricted} /></Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Επικοινωνία & εκτυπώσεις</h2><Field label="Email επικοινωνίας" name="contactEmail" type="email" defaultValue={org.contactEmail ?? ""} maxLength={160} disabled={restricted} /><Field label="Όνομα αποστολέα email" name="emailFromName" defaultValue={org.emailFromName ?? ""} maxLength={120} disabled={restricted} /><div className="sm:col-span-2"><Field label="HTTPS URL ή τοπικό μονοπάτι λογοτύπου" name="logoUrl" defaultValue={org.logoUrl ?? ""} maxLength={500} disabled={restricted} /></div><div className="sm:col-span-2"><TextareaField label="Πρόσθετο κείμενο ετικέτας" name="labelExtraText" defaultValue={org.labelExtraText ?? ""} maxLength={1000} rows={4} disabled={restricted} /></div><p className="text-xs text-muted-foreground sm:col-span-2">Τα κλειδιά Viva και ΑΑΔΕ δεν εμφανίζονται και δεν μεταβάλλονται από αυτή τη φόρμα.</p></Card>
      {!restricted ? <Submit className={btn("default", "default", "justify-self-start")}><Save /> Αποθήκευση στοιχείων</Submit> : null}
    </form>
  </Page>;
}
