import { WifiOff } from "lucide-react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { btn } from "@/components/ui";

export default function OfflinePage() {
  return (
    <AuthCard>
      <WifiOff className="size-8 text-gold" />
      <h1 className="text-xl">Δεν υπάρχει σύνδεση</h1>
      <p className="text-muted-foreground">Η εφαρμογή χρειάζεται internet για να δείξει τρέχοντα δεδομένα και να εκδώσει αποδείξεις. Έλεγξε το δίκτυο και δοκίμασε ξανά.</p>
      <Link href="/" prefetch={false} className={btn("default", "lg", "w-full")}>Δοκίμασε ξανά</Link>
    </AuthCard>
  );
}
