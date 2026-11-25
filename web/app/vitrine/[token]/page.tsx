import type { Metadata } from "next";
import Link from "next/link";
import { Monitor, QrCode } from "lucide-react";
import { PublicVitrine } from "@/components/public-vitrine";
import { btn, Card } from "@/components/ui";
import { recordVitrineView } from "@/lib/vitrine-db";

// Το περιεχόμενο εξαρτάται πάντα από το προσωπικό token και από τρέχοντα δεδομένα.
export const instant = false;

export const metadata: Metadata = { title: "Βιτρίνα", robots: { index: false, follow: false } };

export default async function PublicVitrinePage({ params, searchParams }: PageProps<"/vitrine/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  let vitrine;
  try { vitrine = await recordVitrineView(token); } catch { return <main className="mx-auto max-w-2xl p-6"><Card className="p-6"><h1 className="text-xl font-semibold">Η βιτρίνα δεν είναι διαθέσιμη</h1><p className="mt-2 text-sm text-muted-foreground">Ο σύνδεσμος μπορεί να έχει αντικατασταθεί ή η δημοσίευση να έχει τεθεί σε παύση.</p></Card></main>; }
  const tv = query.tv === "1";
  return <main className={`mx-auto p-4 py-7 sm:p-6 ${tv ? "max-w-[140rem]" : "max-w-7xl"}`}><header className="mb-6 flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-muted-foreground">{vitrine.orgName} · {vitrine.storeName}</p><h1 className={`${tv ? "text-4xl" : "text-3xl"} mt-1 font-semibold`}>Οι γεύσεις μας</h1><p className="mt-1 text-sm text-muted-foreground">Η διαθεσιμότητα και τα συστατικά ενημερώνονται από την επιχείρηση.</p></div><div className="flex gap-2 print:hidden"><Link href={`/vitrine/${token}/qr`} className={btn("outline", "sm")}><QrCode /> QR</Link><Link href={`/vitrine/${token}${tv ? "" : "?tv=1"}`} className={btn("outline", "sm")}><Monitor /> {tv ? "Κανονική προβολή" : "TV"}</Link></div></header>{vitrine.items.length ? <PublicVitrine items={vitrine.items} showPrices={vitrine.showPrices} showAllergens={vitrine.showAllergens} tvPageSeconds={vitrine.tvPageSeconds} tv={tv} /> : <Card className="p-8 text-center text-muted-foreground">Δεν υπάρχουν διαθέσιμες γεύσεις αυτή τη στιγμή.</Card>}<footer className="mt-8 text-center text-xs text-muted-foreground">Για αλλεργίες και διατροφικές ανάγκες, επιβεβαίωσε πάντα με το προσωπικό του καταστήματος.</footer></main>;
}
