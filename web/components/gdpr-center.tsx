// Κεντρική οθόνη GDPR: αιτήματα διαγραφής, συναινέσεις, ημερολόγιο. Η ίδια για την πλατφόρμα (scope = null)
// και για κάθε πελάτη (scope = η επιχείρησή του)· αλλάζει μόνο ποια δεδομένα βλέπει.
import { Plus, ShieldCheck, Trash2, X } from "lucide-react";
import Link from "next/link";
import { completeRequest, openRequest, rejectRequest } from "@/app/(app)/gdpr/actions";
import { db } from "@/lib/db";
import { currentConsents, daysLeft, DUE_DAYS, EVENTS, type EventType, PURPOSES, type Purpose, SUBJECT_TYPES, type SubjectType } from "@/lib/gdpr/rules";
import { filterParam, listParams } from "@/lib/paging";
import { DataTable } from "./data-table";
import { Modal } from "./modal";
import { Submit } from "./submit";
import { Badge, btn, Card, cn, Field } from "./ui";

const when = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Athens" });
const dayOnly = new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeZone: "Europe/Athens" });
const TABS = { requests: "Αιτήματα διαγραφής", consents: "Συναινέσεις", log: "Ημερολόγιο" } as const;
const STATUS = { PENDING: { tone: "warning", text: "Ανοιχτό" }, COMPLETED: { tone: "success", text: "Ολοκληρώθηκε" }, REJECTED: { tone: "neutral", text: "Απορρίφθηκε" } } as const;
const SOURCE: Record<string, string> = { activation: "Ενεργοποίηση λογαριασμού", self: "Ο ίδιος", admin: "Καταχώριση διαχειριστή" };
const SUMMARY: Record<string, string> = { tickets: "αιτήματα υποστήριξης (χωρίς όνομα)", customer: "καρτέλα πελάτη", account: "λογαριασμός", files: "αρχεία", sessions: "συνεδρίες", memberships: "συμμετοχές", emails: "email στο ιστορικό", consents: "συναινέσεις (χωρίς IP)", uploads: "αναφορές σε ανεβάσματα" };

export async function GdprCenter({ scope, base, sp }: { scope: string | null; base: string; sp: Record<string, string | string[] | undefined> }) {
  const key = scope ?? "platform";
  const tab = filterParam(sp, "tab", ["requests", "consents", "log"]) ?? "requests";
  const now = new Date();
  const [open, overdue, decided] = await Promise.all([
    db.erasureRequest.count({ where: { orgId: scope, status: "PENDING" } }),
    db.erasureRequest.count({ where: { orgId: scope, status: "PENDING", dueAt: { lt: now } } }),
    db.erasureRequest.findMany({ where: { orgId: scope, status: { not: "PENDING" }, decidedAt: { not: null } }, select: { requestedAt: true, decidedAt: true }, orderBy: { decidedAt: "desc" }, take: 200 }),
  ]);
  const avg = decided.length ? decided.reduce((s, r) => s + (r.decidedAt!.getTime() - r.requestedAt.getTime()), 0) / decided.length / 864e5 : null;
  const tiles = [
    { label: "Ανοιχτά αιτήματα διαγραφής", value: String(open), hint: open ? `Απάντηση μέσα σε ${DUE_DAYS} ημέρες από το αίτημα` : "Δεν εκκρεμεί κανένα", bad: false },
    { label: "Εκπρόθεσμα", value: String(overdue), hint: overdue ? "Πέρασε η προθεσμία: χρειάζονται απάντηση τώρα" : "Καμία προθεσμία δεν έχει περάσει", bad: overdue > 0 },
    { label: "Μέσος χρόνος απάντησης", value: avg === null ? "—" : `${avg < 1 ? "<1" : Math.round(avg)} ημ.`, hint: avg === null ? "Δεν έχει κλείσει αίτημα ακόμα" : `Σε ${decided.length} αιτήματα που έκλεισαν · όριο ${DUE_DAYS} ημέρες`, bad: avg !== null && avg > DUE_DAYS },
  ];
  const href = (t: string) => `${base}${t === "requests" ? "" : `?tab=${t}`}`;

  return (
    <div className="max-w-7xl space-y-4">
      {typeof sp.ok === "string" ? <p role="status" className="rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success-ink">{sp.ok.slice(0, 200)}</p> : null}
      {typeof sp.error === "string" ? <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{sp.error.slice(0, 300)}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label} className="px-5 py-4">
            <p className="font-medium text-muted-foreground">{t.label}</p>
            <p className={cn("mt-1.5 text-3xl leading-tight font-semibold tabular-nums", t.bad && "text-destructive")}>{t.value}</p>
            <p className="mt-1.5 text-muted-foreground">{t.hint}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Ενότητες GDPR" className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-card p-0.5">
          {Object.entries(TABS).map(([t, label]) => <Link key={t} href={href(t)} aria-current={t === tab ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap pointer-coarse:py-2.5", t === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</Link>)}
        </nav>
        <span className="flex-1" />
        <Modal label={<><Plus /> Νέο αίτημα διαγραφής</>} variant="default" title="Νέο αίτημα διαγραφής" description="Για αίτημα που ήρθε με email, τηλέφωνο ή έγγραφο. Η προθεσμία των 30 ημερών μετρά από σήμερα">
          <form action={openRequest.bind(null, key)} className="grid gap-4 [&>button]:justify-self-end">
            <Field label="Ονοματεπώνυμο" name="name" required minLength={2} maxLength={120} />
            <Field label="Email" name="email" type="email" maxLength={160} hint="Αν ανήκει σε χρήστη της εφαρμογής, το αίτημα δένεται με τον λογαριασμό του και η διαγραφή γίνεται αυτόματα" />
            <Field label="Σημείωση" name="reason" maxLength={500} hint="Πώς ήρθε το αίτημα, τι ζητά. Σβήνεται όταν ολοκληρωθεί" />
            <Submit className={btn("default")}>Καταχώριση αιτήματος</Submit>
          </form>
        </Modal>
      </div>

      <Card>{tab === "requests" ? <Requests scope={scope} sp={sp} /> : tab === "consents" ? <Consents scope={scope} sp={sp} /> : <Log scope={scope} sp={sp} />}</Card>
    </div>
  );
}

type Part = { scope: string | null; sp: Record<string, string | string[] | undefined> };

async function Requests({ scope, sp }: Part) {
  const list = listParams(sp, 20, ["requested", "due"]);
  const status = filterParam(sp, "status", ["PENDING", "COMPLETED", "REJECTED"]);
  const where = { orgId: scope, ...(status ? { status } : {}), ...(list.q ? { subjectLabel: { contains: list.q, mode: "insensitive" as const } } : {}) };
  const [rows, total] = await Promise.all([
    db.erasureRequest.findMany({ where, orderBy: list.sort === "requested" ? { requestedAt: list.dir } : list.sort === "due" ? { dueAt: list.dir } : [{ status: "asc" }, { dueAt: "asc" }], skip: list.skip, take: list.take }),
    db.erasureRequest.count({ where }),
  ]);
  const now = new Date();
  return (
    <DataTable
      id="gdpr-requests"
      listing={{ ...list, total, placeholder: "Όνομα ή email", filters: [{ key: "status", label: "Κατάσταση", value: status, options: Object.entries(STATUS).map(([k, v]): [string, string] => [k, v.text]) }] }}
      empty="Κανένα αίτημα διαγραφής ακόμα. Όταν κάποιος το ζητήσει, θα εμφανιστεί εδώ με την προθεσμία του"
      columns={[
        { key: "who", label: "Πρόσωπο", required: true },
        { key: "kind", label: "Είδος" },
        { key: "requested", label: "Ζητήθηκε", sortable: true },
        { key: "due", label: "Προθεσμία", sortable: true },
        { key: "status", label: "Κατάσταση" },
        { key: "act", label: "Ενέργεια", required: true },
      ]}
      rows={rows.map((r) => {
        const left = daysLeft(r.dueAt, now);
        const counts = r.summary && typeof r.summary === "object" && !Array.isArray(r.summary) ? Object.entries(r.summary).filter(([, v]) => Number(v) > 0) : [];
        return {
          id: r.id,
          cells: {
            who: r.subjectLabel ? <><span className="font-medium">{r.subjectLabel}</span>{r.reason ? <span className="block text-xs text-muted-foreground">{r.reason}</span> : null}</> : <span className="text-muted-foreground">Τα στοιχεία σβήστηκαν · {r.subjectHash.slice(0, 8)}</span>,
            kind: SUBJECT_TYPES[r.subjectType as SubjectType] ?? r.subjectType,
            requested: dayOnly.format(r.requestedAt),
            due: r.status !== "PENDING" ? <span className="text-muted-foreground">{r.decidedAt ? `Έκλεισε ${dayOnly.format(r.decidedAt)}` : "—"}</span> : <Badge tone={left < 0 ? "danger" : left <= 7 ? "warning" : "neutral"}>{left < 0 ? `Εκπρόθεσμο ${-left} ημ.` : left === 0 ? "Λήγει σήμερα" : `Σε ${left} ημ.`}</Badge>,
            status: <><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Badge>{r.status === "REJECTED" && r.decisionNote ? <span className="mt-1 block text-xs text-muted-foreground">{r.decisionNote}</span> : null}{counts.length ? <span className="mt-1 block text-xs text-muted-foreground">{counts.map(([k, v]) => `${v} ${SUMMARY[k] ?? k}`).join(" · ")}</span> : null}</>,
            act: r.status === "PENDING" ? (
              <span className="flex flex-wrap gap-1.5">
                <Modal label={<><Trash2 /> Διαγραφή</>} size="sm" variant="outline" title="Οριστική διαγραφή δεδομένων" description={r.subjectLabel ?? undefined}>
                  <form action={completeRequest.bind(null, r.id)} className="grid gap-4 [&>button]:justify-self-end">
                    <div className="space-y-2 text-sm">
                      <p className="font-medium">Τι θα γίνει, και δεν αναιρείται:</p>
                      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                        {r.subjectType === "user" ? <><li>Σβήνεται ο λογαριασμός, οι συνεδρίες και οι συμμετοχές του</li><li>Το email του αφαιρείται από το ιστορικό αποστολών</li><li>Λαμβάνει ένα τελευταίο email ότι η διαγραφή έγινε</li></> : r.subjectType === "customer" ? <li>Σβήνεται η καρτέλα του πελάτη με όλα τα στοιχεία του</li> : <li>Το αίτημα κλείνει ως ολοκληρωμένο. Βεβαιώσου πρώτα ότι τα στοιχεία του σβήστηκαν και από όσα συστήματα είναι εκτός εφαρμογής</li>}
                        <li>Σβήνονται τα αρχεία που είναι δεμένα μαζί του</li>
                        <li>Μένουν: τα φορολογικά παραστατικά (χωρίς στοιχεία του) και η απόδειξη ότι το αίτημα εκτελέστηκε</li>
                      </ul>
                    </div>
                    <Submit className={btn("destructive")}>Οριστική διαγραφή</Submit>
                  </form>
                </Modal>
                <Modal label={<><X /> Απόρριψη</>} size="sm" variant="ghost" title="Απόρριψη αιτήματος" description="Μόνο όταν ο νόμος επιβάλλει να κρατηθούν τα δεδομένα (π.χ. εκκρεμής νομική αξίωση)">
                  <form action={rejectRequest.bind(null, r.id)} className="grid gap-4 [&>button]:justify-self-end">
                    <Field label="Λόγος απόρριψης" name="note" required minLength={10} maxLength={500} hint="Στέλνεται στο πρόσωπο που έκανε το αίτημα, μαζί με το δικαίωμά του να προσφύγει στην Αρχή" />
                    <Submit className={btn("default")}>Απόρριψη αιτήματος</Submit>
                  </form>
                </Modal>
              </span>
            ) : <span className="text-muted-foreground">—</span>,
          },
        };
      })}
    />
  );
}

async function Consents({ scope, sp }: Part) {
  const list = listParams(sp, 20);
  const purpose = filterParam(sp, "purpose", Object.keys(PURPOSES) as Purpose[]);
  // shortcut: η τρέχουσα κατάσταση υπολογίζεται από τις 2.000 πιο πρόσφατες γραμμές του επιπέδου· πάνω από αυτό θέλει ερώτημα DISTINCT ON
  const rows = await db.consent.findMany({ where: { orgId: scope, ...(purpose ? { purpose } : {}) }, orderBy: { at: "desc" }, take: 2000 });
  const bySubject = new Map<string, typeof rows>();
  for (const r of rows) bySubject.set(`${r.subjectType}:${r.subjectId}`, [...(bySubject.get(`${r.subjectType}:${r.subjectId}`) ?? []), r]);
  const users = new Map((await db.user.findMany({ where: { id: { in: rows.filter((r) => r.subjectType === "user").map((r) => r.subjectId) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]));
  for (const c of scope ? await db.party.findMany({ where: { orgId: scope, id: { in: rows.filter((r) => r.subjectType === "customer").map((r) => r.subjectId) } }, select: { id: true, name: true, email: true } }) : []) users.set(c.id, { id: c.id, name: c.name, email: c.email ?? "" });
  const current = [...bySubject.values()].flatMap((rs) => [...currentConsents(rs).values()])
    .map((c) => ({ c, who: users.get(c.subjectId) }))
    .filter(({ who }) => !list.q || `${who?.name} ${who?.email}`.toLowerCase().includes(list.q.toLowerCase()))
    .sort((a, b) => b.c.at.getTime() - a.c.at.getTime());
  return (
    <DataTable
      id="gdpr-consents"
      listing={{ ...list, total: current.length, placeholder: "Όνομα ή email", filters: [{ key: "purpose", label: "Σκοπός", value: purpose, options: Object.entries(PURPOSES).map(([k, v]): [string, string] => [k, v.label]) }] }}
      empty="Καμία συναίνεση ακόμα. Καταγράφονται όταν ένας χρήστης αποδέχεται τους όρους ή αλλάζει τις επιλογές του στο «Τα δεδομένα μου»"
      columns={[
        { key: "who", label: "Πρόσωπο", required: true },
        { key: "purpose", label: "Σκοπός" },
        { key: "state", label: "Τώρα" },
        { key: "version", label: "Έκδοση" },
        { key: "at", label: "Από" },
        { key: "source", label: "Πώς δόθηκε" },
      ]}
      rows={current.slice(list.skip, list.skip + list.take).map(({ c, who }) => ({
        id: c.id,
        cells: {
          who: who ? <><span className="font-medium">{who.name}</span><span className="block text-xs text-muted-foreground">{who.email}</span></> : <span className="text-muted-foreground">{c.subjectType === "user" ? "Διαγραμμένος χρήστης" : `${SUBJECT_TYPES[c.subjectType as SubjectType] ?? c.subjectType} ${c.subjectId.slice(0, 8)}`}</span>,
          purpose: PURPOSES[c.purpose as Purpose]?.label ?? c.purpose,
          state: <Badge tone={c.granted ? "success" : "neutral"}>{c.granted ? "Ισχύει" : "Ανακλήθηκε"}</Badge>,
          version: c.version,
          at: when.format(c.at),
          source: SOURCE[c.source] ?? c.source,
        },
      }))}
    />
  );
}

async function Log({ scope, sp }: Part) {
  const list = listParams(sp, 25, ["at"]);
  const type = filterParam(sp, "type", Object.keys(EVENTS) as EventType[]);
  const where = { orgId: scope, ...(type ? { type } : {}), ...(list.q ? { OR: [{ subjectLabel: { contains: list.q, mode: "insensitive" as const } }, { actorLabel: { contains: list.q, mode: "insensitive" as const } }] } : {}) };
  const [rows, total] = await Promise.all([db.gdprEvent.findMany({ where, orderBy: { at: list.sort === "at" ? list.dir : "desc" }, skip: list.skip, take: list.take }), db.gdprEvent.count({ where })]);
  const detail = (d: unknown) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) return "";
    const o = d as Record<string, unknown>;
    return [typeof o.purpose === "string" ? (PURPOSES[o.purpose as Purpose]?.label ?? o.purpose) : null, typeof o.version === "string" ? `έκδοση ${o.version}` : null, typeof o.note === "string" ? o.note : null, o.bySubject === true ? "από τον ίδιο" : null,
      ...Object.entries(o).filter(([k, v]) => k in SUMMARY && Number(v) > 0).map(([k, v]) => `${v} ${SUMMARY[k]}`)].filter(Boolean).join(" · ");
  };
  return (
    <DataTable
      id="gdpr-log"
      listing={{ ...list, total, placeholder: "Πρόσωπο ή χειριστής", filters: [{ key: "type", label: "Ενέργεια", value: type, options: Object.entries(EVENTS) }] }}
      empty="Το ημερολόγιο είναι άδειο. Κάθε συναίνεση, λήψη δεδομένων και αίτημα διαγραφής γράφεται εδώ και δεν αλλάζει"
      columns={[
        { key: "at", label: "Πότε", required: true, sortable: true },
        { key: "type", label: "Ενέργεια" },
        { key: "subject", label: "Αφορά" },
        { key: "actor", label: "Από" },
        { key: "detail", label: "Λεπτομέρειες" },
      ]}
      rows={rows.map((e) => ({
        id: e.id,
        cells: {
          at: when.format(e.at),
          type: <span className="inline-flex items-center gap-1.5 font-medium"><ShieldCheck className="size-4 text-muted-foreground" />{EVENTS[e.type as EventType] ?? e.type}</span>,
          subject: e.subjectLabel ?? <span className="text-muted-foreground">{e.subjectType ? "Τα στοιχεία σβήστηκαν" : "—"}</span>,
          actor: e.actorLabel,
          detail: <span className="text-muted-foreground">{detail(e.detail)}</span>,
        },
      }))}
    />
  );
}
