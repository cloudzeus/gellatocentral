import { GdprCenter } from "@/components/gdpr-center";
import { Page } from "@/components/ui";
import { currentOrg } from "@/lib/auth";

// GDPR του πελάτη: τα υποκείμενα της δικής του επιχείρησης (προσωπικό και, όταν χτιστούν, οι πελάτες του).
export default async function GdprPage({ searchParams }: PageProps<"/gdpr">) {
  const { org } = await currentOrg("gdpr.read");
  return (
    <Page section="Ρυθμίσεις" title="GDPR & συναινέσεις" description={`Προσωπικά δεδομένα της ${org.name}: συναινέσεις, αιτήματα διαγραφής και ημερολόγιο`}>
      <GdprCenter scope={org.id} base="/gdpr" sp={await searchParams} />
    </Page>
  );
}
