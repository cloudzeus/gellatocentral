import { SearchX } from "lucide-react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { StateScreen } from "@/components/state-screen";
import { btn } from "@/components/ui";

// A4 γενική · Λάθος διεύθυνση έξω από την εφαρμογή.
export default function NotFound() {
  return (
    <AuthCard>
      <StateScreen tone="neutral" icon={SearchX} heading="h1" title="Η σελίδα δεν βρέθηκε" actions={<Link href="/" className={btn()}>Αρχική σελίδα</Link>}>
        Η διεύθυνση μπορεί να άλλαξε ή να γράφτηκε λάθος.
      </StateScreen>
    </AuthCard>
  );
}
