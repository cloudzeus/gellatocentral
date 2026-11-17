import { GdprCenter } from "@/components/gdpr-center";
import { Page } from "@/components/ui";
import { requirePlatform } from "@/lib/auth";

// GDPR της πλατφόρμας: το προσωπικό της και λογαριασμοί που δεν ανήκουν σε επιχείρηση. Κάθε πελάτης διαχειρίζεται τα δικά του στο /gdpr.
export default async function PlatformGdprPage({ searchParams }: PageProps<"/platform/gdpr">) {
  await requirePlatform("gdpr.manage");
  return (
    <Page section="Πλατφόρμα" title="GDPR & συναινέσεις" description="Προσωπικά δεδομένα της πλατφόρμας: συναινέσεις, αιτήματα διαγραφής και ημερολόγιο. Κάθε πελάτης έχει τη δική του οθόνη για τα δικά του πρόσωπα">
      <GdprCenter scope={null} base="/platform/gdpr" sp={await searchParams} />
    </Page>
  );
}
