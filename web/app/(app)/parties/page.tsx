import { Eye, MapPin, Plus, Power } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Modal } from "@/components/modal";
import { RoleBadges } from "@/components/party-bits";
import { PartyForm } from "@/components/party-form";
import { Submit } from "@/components/submit";
import { Badge, Card, cn, menuItem, Page } from "@/components/ui";
import { db } from "@/lib/db";
import { filterParam, listParams } from "@/lib/paging";
import { isPartyRole, PARTY_ROLES, type PartyRole } from "@/lib/parties";
import { partyScope } from "@/lib/party-scope";
import { partyRefs } from "@/lib/refs";
import { saveParty, toggleParty } from "./actions";

// Η λίστα συναλλασσομένων: της επιχείρησης του χρήστη ή, για το προσωπικό, της πλατφόρμας (ίδια σελίδα, άλλο πεδίο).
export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await partyScope();
  const sp = await searchParams;
  const list = listParams(sp, 25, ["name", "city", "created"]);
  const status = filterParam(sp, "status", ["active", "inactive"]);
  const role = isPartyRole(sp.role) ? sp.role : null;
  const refs = await partyRefs();
  const region = filterParam(sp, "region", refs.regions);
  const like = { contains: list.q, mode: "insensitive" as const };
  const mine = { orgId: scope.orgId };
  const where = {
    ...mine,
    ...(role ? { roles: { has: role } } : {}),
    ...(status ? { active: status === "active" } : {}),
    ...(region ? { region } : {}),
    ...(list.q ? { OR: [{ name: like }, { tradeName: like }, { vatNumber: { contains: list.q } }, { email: like }, { phone: { contains: list.q } }, { contactName: like }, { city: like }] } : {}),
  };
  const [rows, total, all, incomplete, ...perRole] = await Promise.all([
    db.party.findMany({ where, orderBy: list.sort === "city" ? { city: list.dir } : list.sort === "created" ? { createdAt: list.dir } : { name: list.sort === "name" ? list.dir : "asc" }, skip: list.skip, take: list.take, include: { _count: { select: { addresses: { where: { kind: "branch" } } } }, linkedOrg: { select: { id: true } } } }),
    db.party.count({ where }),
    db.party.count({ where: mine }),
    db.party.count({ where: { ...mine, active: true, OR: [{ vatNumber: null }, { address: null }] } }),
    ...(Object.keys(PARTY_ROLES) as PartyRole[]).map((r) => db.party.count({ where: { ...mine, roles: { has: r } } })),
  ]);
  const roleKeys = Object.keys(PARTY_ROLES) as PartyRole[];
  const tab = (r: PartyRole | null) => { const q = new URLSearchParams(); if (r) q.set("role", r); return `${scope.base}${q.size ? `?${q}` : ""}`; };

  return (
    <Page section={scope.section} title="Συναλλασσόμενοι" description={scope.orgId ? "Όλοι όσοι συναλλάσσεσαι, μία φορά ο καθένας: πελάτες, προμηθευτές, franchisees, συνεργάτες" : "Οι συναλλασσόμενοι της πλατφόρμας: οι συνδρομητές ως πελάτες, οι προμηθευτές και οι συνεργάτες μας"}
      actions={scope.canEdit ? <Modal label={<><Plus /> Νέος συναλλασσόμενος</>} variant="default" title="Νέος συναλλασσόμενος" description="Γράψε το ΑΦΜ και πάτα «Εύρεση στοιχείων»: τα υπόλοιπα έρχονται από το μητρώο"><PartyForm action={saveParty.bind(null, null)} refs={refs} defaultRole={role ?? undefined} /></Modal> : null}>
      <div className="max-w-7xl space-y-4">
        {typeof sp.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {sp.error.slice(0, 200)}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {roleKeys.slice(0, 3).map((r, i) => (
            <Card key={r} className="px-5 py-4">
              <p className="font-medium text-muted-foreground">{PARTY_ROLES[r].plural}</p>
              <p className="mt-1.5 text-3xl leading-tight font-semibold tabular-nums">{perRole[i]}</p>
              <p className="mt-1.5 text-muted-foreground">{PARTY_ROLES[r].hint}</p>
            </Card>
          ))}
          <Card className="px-5 py-4">
            <p className="font-medium text-muted-foreground">Θέλουν συμπλήρωση</p>
            <p className={cn("mt-1.5 text-3xl leading-tight font-semibold tabular-nums", incomplete ? "text-destructive" : "")}>{incomplete}</p>
            <p className="mt-1.5 text-muted-foreground">{incomplete ? "Ενεργοί χωρίς ΑΦΜ ή χωρίς διεύθυνση: δεν βγαίνει τιμολόγιο" : "Όλοι οι ενεργοί έχουν ΑΦΜ και διεύθυνση"}</p>
          </Card>
        </div>
        <Card>
          <nav aria-label="Ρόλος" className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2.5">
            {[null, ...roleKeys].map((r, i) => (
              <Link key={r ?? "all"} href={tab(r)} aria-current={role === r ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", role === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
                {r ? PARTY_ROLES[r].plural : "Όλοι"} <span className="tabular-nums opacity-70">{r ? perRole[i - 1] : all}</span>
              </Link>
            ))}
          </nav>
          <DataTable
            id="parties"
            listing={{ ...list, total, placeholder: "Επωνυμία, ΑΦΜ, πόλη ή επαφή", filters: [{ key: "region", label: "Περιοχή", value: region, options: refs.regions.map((r): [string, string] => [r, r]) }, { key: "status", label: "Κατάσταση", value: status, options: [["active", "Ενεργοί"], ["inactive", "Ανενεργοί"]] }] }}
            empty={role ? `Κανένας με τον ρόλο «${PARTY_ROLES[role].label}» ακόμα` : "Κανένας συναλλασσόμενος ακόμα. Πάτησε «Νέος συναλλασσόμενος» για την πρώτη καρτέλα"}
            columns={[
              { key: "name", label: "Συναλλασσόμενος", required: true, sortable: true },
              { key: "roles", label: "Ρόλοι" },
              { key: "city", label: "Έδρα · περιοχή", sortable: true },
              { key: "branches", label: "Υποκαταστήματα", numeric: true },
              { key: "contact", label: "Επικοινωνία" },
              { key: "check", label: "Στοιχεία" },
            ]}
            rows={rows.map((c) => ({
              id: c.id,
              cells: {
                name: <><Link href={`${scope.base}/${c.id}`} className="font-semibold underline-offset-2 hover:underline">{c.name}</Link><span className="block text-xs text-muted-foreground">{c.vatNumber ? `ΑΦΜ ${c.countryCode === "GR" ? "" : `${c.countryCode} `}${c.vatNumber}` : "χωρίς ΑΦΜ"}{c.active ? "" : " · ανενεργός"}</span></>,
                roles: <RoleBadges roles={c.roles} />,
                city: c.city || c.region ? <span className="inline-flex items-center gap-1">{c.latitude != null ? <MapPin className="size-3.5 text-muted-foreground" aria-label="Έχει θέση στον χάρτη" /> : null}{[c.city, c.region].filter(Boolean).join(" · ")}</span> : <span className="text-muted-foreground">—</span>,
                branches: c._count.addresses || "—",
                contact: c.phone || c.email ? <>{c.phone ?? c.email}{c.contactName ? <span className="block text-xs text-muted-foreground">{c.contactName}</span> : null}</> : <span className="text-muted-foreground">—</span>,
                check: c.vatCheckedAt ? <Badge tone="success">Επιβεβαιωμένα</Badge> : c.vatNumber ? <Badge>Χωρίς έλεγχο</Badge> : <Badge tone="warning">Λείπει ΑΦΜ</Badge>,
              },
              menu: (
                <>
                  <Link href={`${scope.base}/${c.id}`} role="menuitem" className={menuItem}><Eye /> Άνοιγμα καρτέλας</Link>
                  {c.linkedOrg ? <Link href={`/platform/${c.linkedOrg.id}`} role="menuitem" className={menuItem}><Eye /> Σελίδα συνδρομητή</Link> : null}
                  {scope.canEdit ? <form action={toggleParty.bind(null, c.id)}><Submit role="menuitem" className={menuItem}><Power /> {c.active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</Submit></form> : null}
                </>
              ),
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
