import { LayoutDashboard, SearchX } from "lucide-react";
import Link from "next/link";
import { BackButton } from "@/components/error-screens";
import { StateScreen } from "@/components/state-screen";
import { btn, Card, Page } from "@/components/ui";

// A3 · Λάθος διεύθυνση μέσα στην εφαρμογή: το μενού μένει.
export default function NotFound() {
  return (
    <Page section="Πλοήγηση" title="Η σελίδα δεν βρέθηκε">
      <Card className="mx-auto max-w-lg p-6 sm:p-8">
        <StateScreen
          tone="neutral" icon={SearchX} title="Δεν υπάρχει τέτοια σελίδα"
          actions={<><Link href="/" className={btn()}><LayoutDashboard /> Πίνακας ελέγχου</Link><BackButton /></>}
        >
          Η διεύθυνση μπορεί να άλλαξε ή να γράφτηκε λάθος. Δεν χάλασε τίποτα: διάλεξε από το μενού ή γύρνα πίσω.
        </StateScreen>
      </Card>
    </Page>
  );
}
