import { redirect } from "next/navigation";

// Οι «Πελάτες» έγιναν «Συναλλασσόμενοι»: παλιοί σύνδεσμοι και σελιδοδείκτες συνεχίζουν να δουλεύουν.
export default function CustomersRedirect() {
  redirect("/parties?role=customer");
}
