import { redirect } from "next/navigation";
import { settleVivaPayment } from "@/lib/billing";

// Εδώ γυρίζει ο πελάτης από τη Viva (Success URL της πηγής πληρωμών: <διεύθυνση εφαρμογής>/billing/paid).
// Αν κλείσει τον browser πριν γυρίσει, την πληρωμή την καταχωρεί το webhook /api/webhooks/viva.
export default async function PaidPage({ searchParams }: PageProps<"/billing/paid">) {
  if ((await settleVivaPayment((await searchParams).t)) !== "settled") redirect(`/billing?error=${encodeURIComponent("Δεν επιβεβαιώθηκε η πληρωμή. Αν χρεώθηκες, επικοινώνησε μαζί μας.")}`);
  redirect("/billing?paid=1");
}
