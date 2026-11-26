import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { FormPending } from "@/components/form-pending";
import { Modal } from "@/components/modal";
import { Submit } from "@/components/submit";
import { Badge, btn, Card, Field, Page, Select } from "@/components/ui";
import { currentOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { euro } from "@/lib/money";
import { MODIFIER_KIND_LABEL } from "@/lib/product-catalog";
import { deleteGroup, deleteOption, saveGroup, saveOption, toggleOption } from "./actions";

const KIND_HINT = {
  REQUIRED: "Ο πελάτης διαλέγει ακριβώς όσες ορίζει το προϊόν· η ίδια μπορεί να μπει δύο φορές (π.χ. 2× φιστίκι)",
  EXTRA: "Προαιρετικά, το καθένα μία φορά, με την επιπλέον χρέωσή του",
  REMOVE: "Προαιρετικά «χωρίς …», δεν χρεώνονται ποτέ",
} as const;
const KIND_TONE = { REQUIRED: "warning", EXTRA: "success", REMOVE: "neutral" } as const;

// Ομάδες επιλογών (γεύσεις, έξτρα, αφαιρέσεις) που ανοίγει το ταμείο όταν πατηθεί το προϊόν.
export default async function ProductOptionsPage({ searchParams }: PageProps<"/products/options">) {
  const { org, can } = await currentOrg("products.read");
  const q = await searchParams;
  const groups = await db.modifierGroup.findMany({
    where: { orgId: org.id },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: {
      options: { orderBy: [{ position: "asc" }, { name: "asc" }] },
      products: { where: { product: { orgId: org.id } }, select: { pick: true, product: { select: { id: true, name: true, active: true } } }, orderBy: { product: { name: "asc" } } },
    },
  });

  const groupForm = (g?: (typeof groups)[number]) => (
    <form key={g?.id ?? "new"} action={saveGroup} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="groupId" value={g?.id ?? ""} />
      <Field label="Όνομα ομάδας" name="name" required minLength={2} maxLength={40} defaultValue={g?.name} hint="π.χ. Γεύσεις, Σιρόπια, Χωρίς" />
      <Select label="Είδος" name="kind" required defaultValue={g?.kind ?? "REQUIRED"} options={(["REQUIRED", "EXTRA", "REMOVE"] as const).map((k): [string, string] => [k, MODIFIER_KIND_LABEL[k]])} hint="Υποχρεωτική: διαλέγει όσες ορίζει το προϊόν · Έξτρα: προαιρετικά με χρέωση · Χωρίς: αφαίρεση, δωρεάν" />
      <FormPending label="Αποθήκευση ομάδας…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{g ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  const optionForm = (g: (typeof groups)[number], o?: (typeof g.options)[number]) => (
    <form key={o?.id ?? "new"} action={saveOption} className="grid gap-4 [&>button]:justify-self-end">
      <input type="hidden" name="groupId" value={g.id} />
      <input type="hidden" name="optionId" value={o?.id ?? ""} />
      <Field label="Όνομα επιλογής" name="name" required maxLength={40} defaultValue={o?.name} hint={g.kind === "REMOVE" ? "π.χ. Ζάχαρη — στο ταμείο φαίνεται «Χωρίς ζάχαρη»" : "π.χ. Φιστίκι, Σαντιγί"} />
      {g.kind === "REMOVE" ? null : <Field label="Επιπλέον χρέωση με ΦΠΑ (€)" name="price" inputMode="decimal" defaultValue={o ? (o.priceCents / 100).toFixed(2).replace(".", ",") : ""} hint="π.χ. 0,50 — κενό ή 0 αν δεν χρεώνεται" />}
      <FormPending label="Αποθήκευση επιλογής…" />
      <Submit pendingText="Αποθήκευση…" className={btn("default")}>{o ? "Αποθήκευση" : "Προσθήκη"}</Submit>
    </form>
  );

  return (
    <Page section="Συνταγολόγιο" title="Επιλογές προϊόντων" description="Γεύσεις, έξτρα και «χωρίς» που ζητά το ταμείο όταν πατηθεί ένα προϊόν. Τις συνδέεις με το προϊόν από την επεξεργασία του"
      actions={<span className="flex flex-wrap gap-2"><Link href="/products" className={btn("outline")}><ArrowLeft /> Προϊόντα</Link>{can("products.add") ? <Modal label={<><Plus /> Νέα ομάδα</>} size="sm" title="Νέα ομάδα επιλογών">{groupForm()}</Modal> : null}</span>}>
      <div className="grid gap-4">
        {typeof q.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">Δεν αποθηκεύτηκε: {q.error.slice(0, 200)}</p> : null}
        {groups.length ? groups.map((g) => (
          <Card key={g.id} className="grid gap-3 p-4">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-48 flex-1 space-y-1">
                <h2 className="flex flex-wrap items-center gap-2 font-semibold">{g.name} <Badge tone={KIND_TONE[g.kind]}>{MODIFIER_KIND_LABEL[g.kind]}</Badge></h2>
                <p className="text-xs text-muted-foreground">{KIND_HINT[g.kind]}</p>
              </div>
              {can("products.edit") ? (
                <span className="flex flex-wrap gap-2">
                  <Modal size="sm" label={<><Pencil /> Επεξεργασία</>} title={`Ομάδα: ${g.name}`}>{groupForm(g)}</Modal>
                  <Modal size="sm" variant="ghost" label={<><Trash2 /> Διαγραφή</>} title={`Διαγραφή: ${g.name}`} description="Οι επιλογές της φεύγουν και από όσα προϊόντα τη χρησιμοποιούν.">
                    <form action={deleteGroup.bind(null, g.id)} className="grid gap-4 [&>button]:justify-self-end">
                      <p className="text-sm text-muted-foreground">Οι αποδείξεις που έχουν ήδη εκδοθεί κρατούν τις επιλογές τους. Η διαγραφή δεν αναιρείται.</p>
                      <Submit pendingText="Διαγραφή…" className={btn("destructive")}><Trash2 /> Διαγραφή ομάδας</Submit>
                    </form>
                  </Modal>
                </span>
              ) : null}
            </div>
            {g.options.length ? (
              <ul className="divide-y divide-border/70 rounded-lg border border-border/70 text-sm">
                {g.options.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className={o.active ? "min-w-0 flex-1 font-medium" : "min-w-0 flex-1 font-medium text-muted-foreground line-through"}>{g.kind === "REMOVE" ? `Χωρίς ${o.name}` : o.name}</span>
                    {o.active ? null : <Badge>Κρυφή στο ταμείο</Badge>}
                    <span className="tabular-nums text-muted-foreground">{g.kind === "REMOVE" ? "Δωρεάν" : o.priceCents ? `+${euro(o.priceCents)}` : "Χωρίς χρέωση"}</span>
                    {can("products.edit") ? (
                      <span className="flex gap-1">
                        <Modal size="sm" variant="ghost" label={<><Pencil /><span className="sr-only">Επεξεργασία {o.name}</span></>} title={`Επιλογή: ${o.name}`}>{optionForm(g, o)}</Modal>
                        <form action={toggleOption.bind(null, o.id)}><Submit className={btn("ghost", "sm")}>{o.active ? <><EyeOff /> Απόκρυψη</> : <><Eye /> Εμφάνιση</>}</Submit></form>
                        <Modal size="sm" variant="ghost" label={<><Trash2 /><span className="sr-only">Διαγραφή {o.name}</span></>} title={`Διαγραφή: ${o.name}`}>
                          <form action={deleteOption.bind(null, o.id)} className="grid gap-4 [&>button]:justify-self-end">
                            <p className="text-sm text-muted-foreground">Αν τελείωσε προσωρινά, προτίμησε την «Απόκρυψη». Η διαγραφή δεν αναιρείται.</p>
                            <Submit pendingText="Διαγραφή…" className={btn("destructive")}><Trash2 /> Διαγραφή επιλογής</Submit>
                          </form>
                        </Modal>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-ink">Καμία επιλογή ακόμα — το ταμείο δεν θα δείξει αυτή την ομάδα μέχρι να προσθέσεις τουλάχιστον μία.</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {can("products.add") ? <Modal size="sm" label={<><Plus /> Νέα επιλογή</>} title={`Νέα επιλογή στο «${g.name}»`}>{optionForm(g)}</Modal> : null}
              <span className="min-w-0 flex-1">{g.products.length
                ? <>Τη χρησιμοποιούν: {g.products.map((l) => `${l.product.name}${g.kind === "REQUIRED" ? ` (${l.pick})` : ""}${l.product.active ? "" : " · κρυφό"}`).join(", ")}</>
                : "Δεν τη χρησιμοποιεί ακόμα κανένα προϊόν· σύνδεσέ την από την επεξεργασία προϊόντος"}</span>
            </div>
          </Card>
        )) : (
          <Card className="grid justify-items-center gap-3 p-8 text-center">
            <p className="font-semibold">Καμία ομάδα επιλογών ακόμα</p>
            <p className="max-w-prose text-sm text-muted-foreground">Ξεκίνα π.χ. με «Γεύσεις» (υποχρεωτική επιλογή), «Σιρόπια» (έξτρα με χρέωση) ή «Χωρίς» (αφαίρεση). Μετά σύνδεσέ τες με τα προϊόντα από την επεξεργασία τους.</p>
            {can("products.add") ? <Modal label={<><Plus /> Πρώτη ομάδα</>} variant="default" size="sm" title="Νέα ομάδα επιλογών">{groupForm()}</Modal> : null}
          </Card>
        )}
      </div>
    </Page>
  );
}
