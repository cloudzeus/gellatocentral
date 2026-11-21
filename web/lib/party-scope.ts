// Σε ποιο αρχείο συναλλασσομένων δουλεύει ο χρήστης: της επιχείρησής του, ή (προσωπικό πλατφόρμας) της πλατφόρμας.
// Ένας χρήστης είναι είτε μέλος επιχείρησης είτε προσωπικό, άρα το πεδίο βγαίνει από τον ίδιο και ποτέ από το URL.
import { currentOrg, requirePlatform, requireUser } from "./auth";
import type { Action, Permission } from "./permissions";

export type PartyScope = { orgId: string | null; base: "/parties" | "/platform/parties"; can: (a: Action) => boolean; canEdit: boolean; actor: { id: string; name: string }; section: string };

export async function partyScope(): Promise<PartyScope> {
  const user = await requireUser();
  if (user.memberships[0]) {
    const { org, can } = await currentOrg("parties.read");
    const write = can("parties.add") || can("parties.edit") || can("parties.delete");
    return { orgId: org.id, base: "/parties", can: (a) => can(`parties.${a}` as Permission), canEdit: write, actor: { id: user.id, name: user.name }, section: "Πελάτες & πωλήσεις" };
  }
  const staff = await requirePlatform("orgs.read");
  const can = (a: Action) => (a === "read" ? true : a === "add" ? staff.can("orgs.add") : a === "edit" ? staff.can("orgs.edit") : a === "delete" ? staff.can("orgs.delete") : false);
  return { orgId: null, base: "/platform/parties", can, canEdit: staff.can("orgs.add") || staff.can("orgs.edit"), actor: { id: user.id, name: user.name }, section: "Πλατφόρμα" };
}
