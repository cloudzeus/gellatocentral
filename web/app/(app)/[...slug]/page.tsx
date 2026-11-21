import { Hammer } from "lucide-react";
import { notFound } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { ALL_ITEMS } from "@/lib/nav";

// Οι ενότητες του Gelato System που δεν έχουν χτιστεί ακόμα στη νέα εφαρμογή (βλ. docs/analysis).
export default async function ComingSoon({ params }: PageProps<"/[...slug]">) {
  const path = `/${(await params).slug.join("/")}`;
  const item = ALL_ITEMS.find((i) => i.to === path);
  if (!item) notFound();
  await currentOrg("dashboard.read");
  return (
    <Page section={item.section} title={item.label}>
      <Card className="mx-auto max-w-lg p-8 text-center">
        <Hammer className="mx-auto size-8 text-gold" />
        <h2 className="mt-3 text-lg">Αυτή η ενότητα χτίζεται</h2>
        <p className="mt-2 text-muted-foreground">Η «{item.label}» μεταφέρεται από το Gelato System σε επόμενη φάση. Το ταμείο, οι αποδείξεις, οι συσκευές και η συνδρομή λειτουργούν ήδη.</p>
      </Card>
    </Page>
  );
}
