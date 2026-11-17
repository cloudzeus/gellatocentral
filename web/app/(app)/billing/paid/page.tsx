import { redirect } from "next/navigation";
import { settleCharge } from "@/lib/billing";
import { db } from "@/lib/db";
import { getTransaction, withVat } from "@/lib/viva/checkout";

// Εδώ γυρίζει ο πελάτης από τη Viva (Success URL της πηγής πληρωμών: <διεύθυνση εφαρμογής>/billing/paid).
// Δεν εμπιστευόμαστε το URL: ρωτάμε τη Viva για τη συναλλαγή και ταιριάζουμε κωδικό εντολής και ποσό με τη χρέωση.
// shortcut: αν ο πελάτης κλείσει τον browser πριν γυρίσει εδώ, η πληρωμή δεν καταχωρείται μόνη της·
// χρειάζεται και το webhook «Transaction Payment Created» της Viva πριν από την παραγωγή.
export default async function PaidPage({ searchParams }: PageProps<"/billing/paid">) {
  const t = (await searchParams).t;
  const tx = typeof t === "string" && /^[0-9a-f-]{36}$/i.test(t) ? await getTransaction(t).catch(() => null) : null;
  const charge = tx?.paid ? await db.subscriptionCharge.findUnique({ where: { vivaOrderCode: tx.orderCode } }) : null;
  if (!tx || !charge || tx.amountCents !== withVat(charge.amountCents)) redirect(`/billing?error=${encodeURIComponent("Δεν επιβεβαιώθηκε η πληρωμή. Αν χρεώθηκες, επικοινώνησε μαζί μας.")}`);
  await settleCharge(charge.id, t as string);
  redirect("/billing?paid=1");
}
