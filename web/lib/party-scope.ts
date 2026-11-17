// Σε ποιο αρχείο συναλλασσομένων δουλεύει ο χρήστης: της επιχείρησής του, ή (προσωπικό πλατφόρμας) της πλατφόρμας.
// Ένας χρήστης είναι είτε μέλος επιχείρησης είτε προσωπικό, άρα το πεδίο βγαίνει από τον ίδιο και ποτέ από το URL.
import { currentOrg, requirePlatform, requireUser } from "./auth";

export type PartyScope = { orgId: string | null; base: "/parties" | "/platform/parties"; canEdit: boolean; actor: { id: string; name: string }; section: string };

export async function partyScope(): Promise<PartyScope> {
  const user = await requireUser();
  if (user.memberships[0]) {
    const { org } = await currentOrg("customers.manage");
    return { orgId: org.id, base: "/parties", canEdit: true, actor: { id: user.id, name: user.name }, section: "Πελάτες & πωλήσεις" };
  }
  const staff = await requirePlatform("orgs.view");
  return { orgId: null, base: "/platform/parties", canEdit: staff.can("orgs.create"), actor: { id: user.id, name: user.name }, section: "Πλατφόρμα" };
}
