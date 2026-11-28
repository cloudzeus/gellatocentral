"use client";

// Ταμείο του browser: ίδια ροή με το ταμείο Android (mobile/App.tsx), σε σκούρο navy με ζωντανά χρώματα κατηγοριών.
// Το καλάθι ζει στον browser· τιμές, ΦΠΑ και απόδειξη τα βγάζει πάντα ο server στο «Είσπραξη».
import { ArrowLeft, Banknote, CakeSlice, Check, Clock, Coffee, CreditCard, CupSoda, IceCreamCone, LayoutGrid, LoaderCircle, type LucideIcon, Minus, ReceiptText, Search, Send, ShoppingBasket, SlidersHorizontal, Star, StickyNote, Tag, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { TillCategory, TillProduct } from "@/lib/pos-catalog";
import { dropOption, type Group, missingIn, tapOption, totals, unitPrice } from "@/lib/till";
import { cn } from "@/lib/utils";
import { cancelPending, charge, syncPayment, toggleSoldOut } from "./actions";
import { payShare, sendRound, settle } from "./bill-actions";
import { type BillData, type BillLine, BillPanel, type BillPay, billTitle, Floor, type Method, seatsOf } from "./tables";
import { CashDialog, Dialog, euro, focus, ghost, grad, kinds, PALETTE, primary, type Status, StatusDialog, Stepper, type Tone } from "./till-ui";

const CAT_ICONS: [RegExp, LucideIcon][] = [[/παγωτ|χωνά|κύπελ/i, IceCreamCone], [/γραν|χυμ|smooth|ρόφ|αναψ/i, CupSoda], [/καφ|coffee|espresso/i, Coffee], [/γλυκ|κέικ|τούρτ|βάφλ|κρέπ/i, CakeSlice]];
const catIcon = (name: string) => CAT_ICONS.find(([re]) => re.test(name))?.[1] ?? Tag;

// seat: θέση στο τραπέζι, μόνο όταν η παραγγελία πηγαίνει σε λογαριασμό
type CartLine = { key: string; productId: string; options: string[]; note: string; quantity: number; seat?: number };
const lineKey = (productId: string, options: readonly string[], note: string, seat?: number) => JSON.stringify([productId, [...options].sort(), note.trim(), seat ?? 0]);
type Draft = { product: TillProduct; tone: Tone; editKey?: string; options: string[]; note: string; quantity: number; seat?: number };
/** Ο λογαριασμός που δέχεται την παραγγελία (αντί για είσπραξη). */
type Target = { id: string; title: string; seats: number };

/** «2× Φιστίκι, Βανίλια, Χωρίς ζάχαρη», με τη σειρά των ομάδων. */
function optionsText(groups: readonly Group[], chosen: readonly string[]) {
  const parts: string[] = [];
  for (const g of groups) for (const o of g.options) {
    const n = chosen.filter((x) => x === o.id).length;
    if (n) parts.push(n > 1 ? `${n}× ${o.name}` : o.name);
  }
  return parts.join(", ");
}
const RULE: Record<Group["kind"], (g: Group) => string> = {
  REQUIRED: (g) => (g.pick > 1 ? `διάλεξε ${g.pick} · η ίδια μπορεί και δύο φορές` : "διάλεξε 1"),
  EXTRA: () => "προαιρετικά",
  REMOVE: () => "προαιρετικά, δεν αλλάζει η τιμή",
};

export function Till({ deviceId, categories, frequent: frequentIds, soldOut: soldOutInit, methods, live, pending, last, header, tables }: {
  deviceId: string; categories: TillCategory[]; frequent: string[]; soldOut: string[]; methods: Method[]; live: boolean; tables: boolean;
  pending: { id: string; totalCents: number; method: string; share?: boolean } | null;
  last: { id: string; series: string; aa: number; totalCents: number } | null;
  header: ReactNode;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string>();
  const [cat, setCat] = useState<number>();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [methodId, setMethodId] = useState<string>();
  const [cash, setCash] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // κινητό: το καλάθι ανοίγει σε όλη την οθόνη
  const [soldOut, setSoldOut] = useState<ReadonlySet<string>>(() => new Set(soldOutInit));
  const [status, setStatus] = useState<Status | null>(() => (pending ? { kind: "waiting", saleId: pending.id, totalCents: pending.totalCents, method: pending.method, share: pending.share } : null));
  const [view, setView] = useState<"sale" | "tables">("sale");
  const [billId, setBillId] = useState<string>();
  const [target, setTarget] = useState<Target>();
  const [seat, setSeat] = useState<number>();
  const [reload, setReload] = useState(0); // κάτοψη/λογαριασμός ξαναφορτώνουν μετά από πληρωμή ή αποστολή
  const [cashFor, setCashFor] = useState<{ pay: BillPay; m: Method }>(); // μετρητά για λογαριασμό: πρώτα ρέστα
  const [note, setNote] = useState<string>(); // π.χ. είδη του «Ξανά» που δεν υπάρχουν πια
  const searchRef = useRef<HTMLInputElement>(null);

  // Το καλάθι μένει στη συσκευή όταν ανανεώνεται η σελίδα (ανά ταμείο).
  const storeKey = `pos-cart:${deviceId}`;
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "[]") as CartLine[];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- μία φορά, μετά το hydration (ο server δεν ξέρει το καλάθι)
      if (Array.isArray(saved) && saved.length) setCart(saved);
    } catch { /* χαλασμένο αποθηκευμένο καλάθι: ξεκινά άδειο */ }
    loaded.current = true;
  }, [storeKey]);
  useEffect(() => { if (loaded.current) localStorage.setItem(storeKey, JSON.stringify(cart)); }, [cart, storeKey]);

  const colorOf = (i: number) => { const c = categories[i]?.color; return PALETTE[c && c >= 1 && c <= 8 ? c - 1 : 1 + (i % 7)]; };
  const byId = useMemo(() => new Map(categories.flatMap((c, i) => c.products.map((p) => [p.id, { product: p, tone: colorOf(i) }] as const))), [categories]); // eslint-disable-line react-hooks/exhaustive-deps -- colorOf εξαρτάται μόνο από categories
  const frequent = useMemo(() => frequentIds.map((id) => byId.get(id)?.product).filter((p): p is TillProduct => !!p), [frequentIds, byId]);
  const tab = cat ?? (frequent.length ? -1 : 0); // -1 = «Συχνά»
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  const lines = cart.flatMap((l) => {
    const hit = byId.get(l.productId);
    return hit ? [{ ...l, product: hit.product, tone: hit.tone, unitCents: unitPrice(hit.product.priceCents, hit.product.groups, l.options) }] : [];
  });
  const sums = totals(lines.map((l) => ({ priceCents: l.unitCents, vatRate: l.product.vatRate, quantity: l.quantity })));
  const items = lines.reduce((n, l) => n + l.quantity, 0);
  const inCart = (id: string) => cart.reduce((n, l) => n + (l.productId === id ? l.quantity : 0), 0);
  const plainKey = (id: string) => lineKey(id, [], "", target ? seat : undefined);

  const putLine = (productId: string, options: string[], note: string, quantity: number, editKey?: string, lineSeat = target ? seat : undefined) => setCart((c) => {
    const key = lineKey(productId, options, note, lineSeat);
    const rest = editKey ? c.filter((l) => l.key !== editKey) : c;
    if (rest.some((l) => l.key === key)) return rest.map((l) => (l.key === key ? { ...l, quantity: l.quantity + quantity } : l));
    const line = { key, productId, options, note: note.trim(), quantity, seat: lineSeat };
    return editKey ? c.map((l) => (l.key === editKey ? line : l)) : [...c, line];
  });
  const setQty = (key: string, n: number) => {
    setCart((c) => (n <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: Math.min(999, n) } : l))));
    if (n <= 0 && selected === key) setSelected(undefined);
  };
  const clear = () => { setCart([]); setSelected(undefined); };

  // Προϊόν με υποχρεωτικές επιλογές ανοίγει το φύλλο· τα άλλα μπαίνουν κατευθείαν.
  const tapProduct = (p: TillProduct, tone: Tone) => {
    if (soldOut.has(p.id)) return;
    if (p.groups.some((g) => g.kind === "REQUIRED")) setDraft({ product: p, tone, options: [], note: "", quantity: 1, seat: target ? seat : undefined });
    else putLine(p.id, [], "", 1);
  };
  const editLine = (l: (typeof lines)[number]) => setDraft({ product: l.product, tone: l.tone, editKey: l.key, options: l.options, note: l.note, quantity: l.quantity, seat: l.seat });
  const flipSoldOut = (p: TillProduct) => startTransition(async () => {
    try { setSoldOut(new Set(await toggleSoldOut(p.id, !soldOut.has(p.id)))); } catch { setStatus({ kind: "failed", message: "Δεν αποθηκεύτηκε το «τελείωσε». Δοκίμασε ξανά" }); }
  });

  const run = (m: Method) => {
    setCash(false);
    const totalCents = sums.totalCents;
    startTransition(async () => {
      const r = await charge(cart.map((l) => ({ productId: l.productId, quantity: l.quantity, options: l.options, note: l.note || undefined })), m.id);
      if ("error" in r) setStatus({ kind: "failed", message: r.error });
      else if ("pending" in r) setStatus({ kind: "waiting", saleId: r.pending, totalCents, method: m.name });
      else { setStatus({ kind: "paid", ...r.paid, method: m.name }); clear(); }
      router.refresh();
    });
  };
  const collect = () => { if (method) { if (method.cash) setCash(true); else run(method); } };
  const cartOut = () => cart.map((l) => ({ productId: l.productId, quantity: l.quantity, options: l.options, note: l.note || undefined, seat: l.seat }));

  // ---- Τραπέζια ----
  const openBillView = (id: string) => { setBillId(id); setView("tables"); };
  const toTables = () => { setTarget(undefined); setSeat(undefined); setView("tables"); };
  /** «Παραγγελία» από τον λογαριασμό: το καλάθι πάει στο τραπέζι, όχι σε είσπραξη. */
  const orderFor = (b: BillData) => { setTarget({ id: b.id, title: billTitle(b), seats: seatsOf(b) }); setSeat(undefined); setNote(undefined); setView("sale"); setCartOpen(false); };
  /** «Ξανά»: ίδιο είδος, ίδιες επιλογές, ίδια θέση. Μία γραμμή = ένα κομμάτι· ολόκληρος γύρος = ίδιες ποσότητες. */
  const again = (b: BillData, ls: BillLine[]) => {
    orderFor(b);
    if (ls.length === 1) setSeat(ls[0].seat ?? undefined);
    const missing: string[] = [];
    for (const l of ls) {
      const p = l.productId ? byId.get(l.productId)?.product : undefined;
      const all = p?.groups.flatMap((g) => g.options) ?? [];
      const ids = ((l.options ?? []) as { name: string }[]).map((o) => all.find((x) => x.name === o.name)?.id);
      if (!p || ids.some((x) => !x)) { missing.push(l.name); continue; }
      putLine(p.id, ids as string[], l.note ?? "", ls.length === 1 ? 1 : l.quantity, undefined, l.seat ?? undefined);
    }
    if (missing.length) setNote(`Δεν μπήκαν: ${missing.join(", ")}. Δεν υπάρχουν πια στον κατάλογο`);
  };
  /** Η παραγγελία γράφεται στον λογαριασμό ως νέος γύρος. held = «Μετά»: δεν πάει στην κουζίνα ως το «Βγάλ' το». */
  const send = (held: boolean) => {
    if (!target || !cart.length) return;
    const t = target;
    startTransition(async () => {
      try {
        const r = await sendRound(t.id, cartOut(), held);
        if ("error" in r) { setStatus({ kind: "failed", message: `Η παραγγελία δεν στάλθηκε στο ${t.title}. ${r.error}` }); return; }
        clear(); setTarget(undefined); setSeat(undefined); setNote(undefined); setCartOpen(false);
        setBillId(t.id); setView("tables"); setReload((n) => n + 1);
      } catch { setStatus({ kind: "failed", message: `Η παραγγελία δεν στάλθηκε στο ${t.title}. Η παραγγελία έμεινε στην οθόνη, δοκίμασε ξανά` }); }
    });
  };
  /** Είσπραξη από λογαριασμό: απόδειξη για όλο/είδη ή μερίδιο κατά ποσό. */
  const payBill = (pay: BillPay, m: Method) => {
    setCashFor(undefined);
    startTransition(async () => {
      const r = pay.share ? await payShare(pay.billId, m.id, pay.amountCents) : await settle(pay.billId, m.id, pay.lines);
      if ("error" in r) setStatus({ kind: "failed", message: r.error });
      else if ("pending" in r) setStatus({ kind: "waiting", saleId: r.pending, totalCents: pay.amountCents, method: m.name, share: pay.share });
      else setStatus({ kind: "paid", saleId: r.paid.saleId ?? "", totalCents: pay.amountCents, method: m.name, share: !r.paid.saleId });
      setReload((n) => n + 1);
      router.refresh();
    });
  };
  const startBillPay = (pay: BillPay, m: Method) => { setMethodId(m.id); if (m.cash) setCashFor({ pay, m }); else payBill(pay, m); };

  // Πληρωμή στο τερματικό: ρωτάμε τον server κάθε 3 δευτ. ως το αποτέλεσμα.
  // και όσο ο ταμίας επιβεβαιώνει ακύρωση: ο πελάτης μπορεί να πληρώνει εκείνη τη στιγμή
  const waitingId = status?.kind === "waiting" || status?.kind === "cancel" ? status.saleId : undefined;
  useEffect(() => {
    if (!waitingId) return;
    let asking = false;
    const tick = setInterval(async () => {
      if (asking) return;
      asking = true;
      try {
        const r = await syncPayment(waitingId);
        setStatus((s) => {
          if ((s?.kind !== "waiting" && s?.kind !== "cancel") || s.saleId !== waitingId) return s;
          if (r.status === "completed") return { kind: "paid", saleId: s.saleId, totalCents: s.totalCents, method: s.method, share: s.share };
          if (r.status === "failed") return { kind: "failed", message: "Ο πελάτης δεν χρεώθηκε. Η πώληση είναι όπως την άφησες" };
          if (r.status === "rejected") return { kind: "unverified" };
          if (r.status === "not_found") return null;
          return s.kind === "waiting" ? { ...s, slow: r.status === "error" } : s;
        });
        if (r.status === "completed") { if (view === "sale" && !target) clear(); setReload((n) => n + 1); router.refresh(); }
      } finally { asking = false; }
    }, 3000);
    return () => clearInterval(tick);
  }, [waitingId, router]); // eslint-disable-line react-hooks/exhaustive-deps -- view/target: μόνο για το αν αδειάζει το καλάθι

  const q = query.trim().toLowerCase();
  const shown = q
    ? categories.flatMap((c, i) => c.products.filter((p) => p.name.toLowerCase().includes(q) || p.code?.toLowerCase() === q).map((p) => ({ p, tone: colorOf(i) })))
    : tab === -1 ? frequent.map((p) => ({ p, tone: byId.get(p.id)!.tone }))
    : (categories[tab]?.products ?? []).map((p) => ({ p, tone: colorOf(tab) }));
  const heading = q ? `Αναζήτηση «${query.trim()}»` : tab === -1 ? "Συχνά" : categories[tab]?.name ?? "";
  const tiles = [
    ...(frequent.length ? [{ i: -1, name: "Συχνά", count: frequent.length, tone: PALETTE[0], Icon: Star }] : []),
    ...categories.map((c, i) => ({ i, name: c.name, count: c.products.length, tone: colorOf(i), Icon: catIcon(c.name) })),
  ];

  // «/» πηγαίνει στην αναζήτηση, όπως ο σαρωτής: Enter με ένα αποτέλεσμα το βάζει στο καλάθι.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shownStatus = status?.kind === "paid" && last?.id === status.saleId ? { ...status, series: last.series, aa: last.aa } : status;

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      {header}
      {!live ? (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium lg:mx-6">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          Δοκιμαστική λειτουργία: οι αποδείξεις αποθηκεύονται αλλά δεν στέλνονται στην ΑΑΔΕ, γιατί δεν έχουν οριστεί κλειδιά Viva
        </p>
      ) : null}

      {tables ? (
        <div role="tablist" aria-label="Οθόνη ταμείου" className="mx-4 mt-3 flex gap-1 self-start rounded-xl bg-card p-1 lg:mx-6">
          {([["sale", "Πώληση", ShoppingBasket], ["tables", "Τραπέζια", LayoutGrid]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn("flex h-11 items-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary", focus)}>
              <Icon className="size-4.5" strokeWidth={1.75} aria-hidden />{label}
            </button>
          ))}
        </div>
      ) : null}

      {view === "tables" ? (
        <div className="grid flex-1 gap-4 px-4 pt-4 pb-[calc(var(--bottom-nav-h,0px)+var(--feedback-h,0px)+1.5rem)] lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-6 lg:pb-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <Floor selected={billId} reload={reload} onOpen={openBillView} />
          {/* Λογαριασμός: στήλη δεξιά στον υπολογιστή, πλήρης οθόνη στο κινητό */}
          <aside aria-label="Λογαριασμός" className={cn("flex-col bg-sidebar p-4 lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-10rem-var(--feedback-h,0px))] lg:self-start lg:rounded-2xl lg:ring-1 lg:ring-border", billId ? "fixed inset-0 z-50 flex" : "hidden")}>
            {billId ? (
              <BillPanel id={billId} reload={reload} busy={busy} methods={methods} method={method} setMethodId={setMethodId}
                onClose={() => { setBillId(undefined); setReload((n) => n + 1); }} onAdd={orderFor} onAgain={again} onPay={startBillPay} />
            ) : (
              <div className="grid flex-1 place-items-center text-center text-base text-muted-foreground">
                <p className="max-w-60">Πάτα ένα τραπέζι για τον λογαριασμό του, ή ένα ελεύθερο για νέο</p>
              </div>
            )}
          </aside>
        </div>
      ) : (
      <div className="grid flex-1 gap-4 px-4 pt-4 pb-[calc(var(--bottom-nav-h,0px)+var(--feedback-h,0px)+5.5rem)] lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-6 lg:pb-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0 space-y-4" aria-label="Προϊόντα">
          <label className="flex h-12 items-center gap-2 rounded-xl bg-card px-4 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
            <Search className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Αναζήτηση προϊόντος ή κωδικού" aria-label="Αναζήτηση προϊόντος" autoComplete="off"
              onKeyDown={(e) => { if (e.key === "Enter" && shown.length === 1) { tapProduct(shown[0].p, shown[0].tone); setQuery(""); } if (e.key === "Escape") setQuery(""); }}
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Καθαρισμός αναζήτησης" className={cn("grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary", focus)}><X className="size-4" /></button>
              : <kbd className="hidden rounded-md border border-border px-1.5 text-xs text-muted-foreground sm:block">/</kbd>}
          </label>

          <div role="tablist" aria-label="Κατηγορίες" className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 lg:-mx-0 lg:px-0">
            {tiles.map(({ i, name, count, tone, Icon }) => {
              const on = !q && i === tab;
              return (
                <button
                  key={i} type="button" role="tab" aria-selected={on} onClick={() => { setCat(i); setQuery(""); }}
                  style={{ backgroundImage: grad(tone), color: tone.ink }}
                  className={cn("flex h-22 min-w-32 flex-1 shrink-0 flex-col justify-between rounded-2xl p-3 text-left transition-[transform,box-shadow] active:scale-[0.98]", on ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-90 hover:opacity-100", focus)}
                >
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold">{name}</span>
                    <span className="block text-xs font-medium tabular-nums opacity-70">{kinds(count)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">{heading}</h2>
            <span className="text-sm text-muted-foreground tabular-nums">{kinds(shown.length)}</span>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-base text-muted-foreground">
              {q ? "Κανένα προϊόν δεν ταιριάζει" : categories.length ? "Αυτή η κατηγορία δεν έχει προϊόντα. Πρόσθεσέ τα στα Προϊόντα" : "Δεν υπάρχουν προϊόντα ακόμα. Πρόσθεσέ τα στα Προϊόντα"}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {shown.map(({ p, tone }) => {
                const n = inCart(p.id);
                const out = soldOut.has(p.id);
                const plain = !p.groups.some((g) => g.kind === "REQUIRED");
                return (
                  <li key={p.id} className="relative">
                    <button
                      type="button" onClick={() => tapProduct(p, tone)} aria-disabled={out}
                      onContextMenu={(e) => { e.preventDefault(); flipSoldOut(p); }}
                      title="Δεξί κλικ ή παρατεταμένο πάτημα: τελείωσε ή υπάρχει ξανά"
                      aria-label={`${p.name}, ${euro(p.priceCents)}${out ? ", τελείωσε" : ""}${n ? `, ${n} στο καλάθι` : ""}${plain ? "" : ", με επιλογές"}`}
                      style={n && !out ? { backgroundImage: grad(tone), color: tone.ink, borderLeftColor: tone.to } : { borderLeftColor: out ? "var(--muted-foreground)" : tone.to }}
                      className={cn("flex h-29 w-full flex-col rounded-2xl border-l-4 bg-card p-3 text-left transition-[background-color,transform,opacity] active:scale-[0.98]", !n && "hover:bg-secondary", out && "opacity-40", focus)}
                    >
                      <span className="flex min-h-4 items-center gap-1.5 text-xs font-semibold tracking-wide opacity-60">
                        {p.code}{!plain ? <SlidersHorizontal className="size-3.5" strokeWidth={2} aria-hidden /> : null}
                      </span>
                      <span className="mt-1 line-clamp-2 text-lg leading-snug font-semibold">{p.name}</span>
                      <span className="mt-auto text-base font-semibold tabular-nums opacity-85">{out ? "Τελείωσε" : euro(p.priceCents)}</span>
                    </button>
                    {n && plain && !out ? (
                      <span className="absolute right-2 bottom-2 flex items-center gap-1" style={{ color: tone.ink }}>
                        <button type="button" onClick={() => setQty(plainKey(p.id), (cart.find((l) => l.key === plainKey(p.id))?.quantity ?? 0) - 1)} aria-label={`Ένα λιγότερο ${p.name}`}
                          className={cn("grid size-8 place-items-center rounded-lg border border-current/30 hover:bg-black/10", focus)}><Minus className="size-4" /></button>
                        <span className="min-w-6 text-center text-base font-bold tabular-nums">{n}</span>
                      </span>
                    ) : n && !out ? (
                      <span className="pointer-events-none absolute right-2 bottom-2.5 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" style={{ background: tone.ink, color: tone.from }}>× {n}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Καλάθι: στήλη δεξιά στον υπολογιστή, πλήρης οθόνη στο κινητό */}
        <aside aria-label="Πώληση" className={cn("flex-col gap-3 bg-sidebar p-4 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:rounded-2xl lg:ring-1 lg:ring-border", cartOpen ? "fixed inset-0 z-50 flex" : "hidden")}>
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="truncate text-lg font-semibold">{target ? `Παραγγελία · ${target.title}` : "Πώληση"}</h2>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{kinds(items)}</span>
            </div>
            <div className="flex gap-1">
              {lines.length ? <button type="button" onClick={clear} aria-label="Άδειασμα πώλησης" className={cn("grid size-11 place-items-center rounded-full border border-border text-muted-foreground hover:bg-secondary", focus)}><Trash2 className="size-4.5" /></button> : <span className="h-11" />}
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Πίσω στα προϊόντα" className={cn("grid size-11 place-items-center rounded-full border border-border text-muted-foreground hover:bg-secondary lg:hidden", focus)}><X className="size-4.5" /></button>
            </div>
          </div>

          {target && target.seats > 1 ? (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Θέση για τα επόμενα είδη</p>
              <div role="radiogroup" aria-label="Θέση" className="scrollbar-hide flex gap-1.5 overflow-x-auto">
                {[undefined, ...Array.from({ length: target.seats }, (_, i) => i + 1)].map((n) => (
                  <button key={n ?? 0} type="button" role="radio" aria-checked={seat === n} onClick={() => setSeat(n)}
                    className={cn("h-11 min-w-11 shrink-0 rounded-xl border px-3 text-base font-semibold transition-colors", seat === n ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary", focus)}>{n ?? "Κοινά"}</button>
                ))}
              </div>
            </div>
          ) : null}
          {note ? <p role="status" className="rounded-xl bg-warning/15 px-3 py-2 text-sm font-medium">{note}</p> : null}

          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {lines.length === 0 ? <li className="py-2 text-base text-muted-foreground">{target ? `Πάτα τα προϊόντα που θα πάνε στο ${target.title}` : "Πάτα ένα προϊόν για να ξεκινήσεις την πώληση"}</li> : null}
            {lines.map((l) => {
              const on = selected === l.key;
              const opts = optionsText(l.product.groups, l.options);
              return (
                <li key={l.key} className={cn("rounded-xl border-l-4 bg-card transition-colors", on && "bg-secondary")} style={{ borderLeftColor: l.tone.to }}>
                  <button type="button" onClick={() => setSelected(on ? undefined : l.key)} aria-expanded={on} className={cn("flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left", focus)}>
                    <span className="grid h-6 min-w-6 place-items-center rounded-full bg-secondary px-1.5 text-xs font-bold tabular-nums">{l.quantity}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold leading-snug">{l.product.name}</span>
                      {opts ? <span className="block text-sm text-muted-foreground">{opts}</span> : null}
                      {l.note ? <span className="block text-sm text-muted-foreground">Σημείωση: {l.note}</span> : null}
                    </span>
                    {l.seat ? <span className="grid h-6 min-w-6 place-items-center rounded-md bg-secondary px-1 text-xs font-bold text-muted-foreground tabular-nums" aria-label={`θέση ${l.seat}`}>{l.seat}</span> : null}
                    <span className="text-base font-semibold tabular-nums">{euro(l.unitCents * l.quantity)}</span>
                  </button>
                  {on ? (
                    <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pl-11">
                      <Stepper value={l.quantity} label={l.product.name} onChange={(n) => setQty(l.key, n)} />
                      <button type="button" onClick={() => editLine(l)} className={ghost}>
                        {l.product.groups.length ? <SlidersHorizontal className="size-4 text-muted-foreground" /> : <StickyNote className="size-4 text-muted-foreground" />}
                        {l.product.groups.length ? "Επιλογές" : "Σημείωση"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="space-y-1.5 rounded-2xl bg-card p-4">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Καθαρή αξία</span><span className="tabular-nums">{euro(sums.netCents)}</span></div>
            <div className="flex justify-between text-sm text-muted-foreground"><span>ΦΠΑ</span><span className="tabular-nums">{euro(sums.vatCents)}</span></div>
            <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2"><span className="text-lg font-semibold">Σύνολο</span><span className="text-3xl font-bold tabular-nums">{euro(sums.totalCents)}</span></div>
          </div>

          {target ? (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => send(true)} disabled={busy || !cart.length} title="Γράφεται στον λογαριασμό· πάει στην κουζίνα όταν πατήσεις «Βγάλ' το»"
                  className={cn(ghost, "h-14 rounded-full px-5 text-lg")}><Clock className="size-5" />Μετά</button>
                <button type="button" onClick={() => send(false)} disabled={busy || !cart.length} className={cn(primary, "flex-1")}>
                  <span className="flex items-center gap-2">{busy ? <LoaderCircle className="size-5 animate-spin" /> : <Send className="size-5" />}{busy ? "Περίμενε" : "Στείλε τώρα"}</span>
                  <span className="tabular-nums">{euro(sums.totalCents)}</span>
                </button>
              </div>
              <button type="button" onClick={() => { clear(); setNote(undefined); setCartOpen(false); toTables(); }} className={ghost}><ArrowLeft className="size-4" />Πίσω στον λογαριασμό</button>
            </>
          ) : methods.length ? (
            <div role="radiogroup" aria-label="Τρόπος πληρωμής" className="flex gap-2">
              {methods.map((m) => {
                const on = m.id === method?.id;
                const Icon = m.cash ? Banknote : CreditCard;
                return (
                  <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => setMethodId(m.id)}
                    className={cn("flex h-15 flex-1 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-semibold transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-secondary", focus)}>
                    <Icon className="size-4.5" strokeWidth={1.75} aria-hidden />{m.name}
                  </button>
                );
              })}
            </div>
          ) : <p className="text-sm font-medium text-destructive">Δεν έχει οριστεί τρόπος πληρωμής για το ταμείο. Όρισέ τον στους Τρόπους πληρωμής</p>}
          {target ? null : (
            <button type="button" onClick={collect} disabled={busy || !sums.totalCents || !method} className={primary}>
              <span className="flex items-center gap-2">{busy ? <LoaderCircle className="size-5 animate-spin" /> : null}{busy ? "Περίμενε" : "Είσπραξη"}</span>
              <span className="tabular-nums">{euro(sums.totalCents)}</span>
            </button>
          )}
          {last && !target ? (
            <Link href={`/receipts/${last.id}`} className={cn("flex items-center justify-between gap-2 rounded-xl px-1 py-1 text-sm text-muted-foreground hover:text-foreground", focus)}>
              <span className="flex items-center gap-2"><ReceiptText className="size-4" aria-hidden />Τελευταία απόδειξη {last.series}-{last.aa}</span>
              <span className="tabular-nums">{euro(last.totalCents)}</span>
            </Link>
          ) : null}
        </aside>
      </div>
      )}

      {/* Κινητό: η πώληση σε μια μπάρα πάνω από το μενού */}
      {!cartOpen && view === "sale" ? (
        <button type="button" onClick={() => setCartOpen(true)} className={cn("fixed inset-x-3 bottom-[calc(var(--bottom-nav-h,0px)+var(--feedback-h,0px)+0.75rem)] z-30 flex h-14 items-center justify-between gap-3 rounded-full bg-foreground px-5 text-base font-semibold text-background shadow-lg lg:hidden", focus)}>
          <span className="flex min-w-0 items-center gap-2"><ShoppingBasket className="size-5 shrink-0" aria-hidden /><span className="truncate">{target ? `Παραγγελία · ${target.title}` : "Πώληση"} · {kinds(items)}</span></span>
          <span className="text-lg tabular-nums">{euro(sums.totalCents)}</span>
        </button>
      ) : null}

      {draft ? <OptionsDialog draft={draft} setDraft={setDraft} soldOut={soldOut} onClose={() => setDraft(undefined)} onDone={() => { putLine(draft.product.id, draft.options, draft.note, draft.quantity, draft.editKey); setDraft(undefined); }} /> : null}
      {cash && method ? <CashDialog totalCents={sums.totalCents} onBack={() => setCash(false)} onContinue={() => run(method)} live={live} /> : null}
      {cashFor ? <CashDialog totalCents={cashFor.pay.amountCents} onBack={() => setCashFor(undefined)} onContinue={() => payBill(cashFor.pay, cashFor.m)} live={live} back="Πίσω στον λογαριασμό" go={cashFor.pay.share ? "Καταγραφή μεριδίου" : undefined} /> : null}
      {shownStatus ? (
        <StatusDialog status={shownStatus} busy={busy} back={view === "tables" ? "Πίσω στον λογαριασμό" : undefined}
          onClose={() => setStatus(null)}
          onAskCancel={() => shownStatus.kind === "waiting" && setStatus({ kind: "cancel", saleId: shownStatus.saleId, totalCents: shownStatus.totalCents, method: shownStatus.method })}
          onKeepWaiting={() => shownStatus.kind === "cancel" && setStatus({ ...shownStatus, kind: "waiting" })}
          onCancel={() => shownStatus.kind === "cancel" && startTransition(async () => {
            const r = await cancelPending(shownStatus.saleId);
            const { saleId, totalCents, method: m, share } = shownStatus;
            setStatus(r.status === "completed" ? { kind: "paid", saleId, totalCents, method: m, share } : r.status === "cancelled" ? null : { kind: "waiting", saleId, totalCents, method: m, share, message: r.message });
            setReload((n) => n + 1);
            router.refresh();
          })}
        />
      ) : null}
    </div>
  );
}

function OptionsDialog({ draft, setDraft, soldOut, onDone, onClose }: { draft: Draft; setDraft: (d: Draft) => void; soldOut: ReadonlySet<string>; onDone: () => void; onClose: () => void }) {
  const { product, options, tone } = draft;
  const missing = product.groups.reduce((n, g) => n + missingIn(g, options), 0);
  const unit = unitPrice(product.priceCents, product.groups, options);
  return (
    <Dialog label={product.name} onClose={onClose} wide>
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ backgroundImage: grad(tone), color: tone.ink }}><IceCreamCone className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{product.name}</h2>
          <p className="text-sm text-muted-foreground tabular-nums">Βασική τιμή {euro(product.priceCents)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Κλείσιμο χωρίς αλλαγές" className={cn("grid size-11 place-items-center rounded-full border border-border text-muted-foreground hover:bg-secondary", focus)}><X className="size-4.5" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {product.groups.map((g) => {
          const left = missingIn(g, options);
          return (
            <fieldset key={g.id} className="space-y-3 border-t border-border pt-5 first:border-0 first:pt-0">
              <legend className="contents">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold">{g.name}</span>
                  <span className="flex-1 text-sm text-muted-foreground">{RULE[g.kind](g)}</span>
                  {g.kind === "REQUIRED" ? (
                    <span aria-live="polite" className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold", left ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                      {left ? <TriangleAlert className="size-3.5" /> : <Check className="size-3.5" />}{left ? `Λείπει ${left}` : "Έτοιμο"}
                    </span>
                  ) : null}
                </span>
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {g.options.map((o) => {
                  const n = options.filter((x) => x === o.id).length;
                  const out = soldOut.has(o.id);
                  const price = g.kind !== "REMOVE" && o.priceCents ? `+${(o.priceCents / 100).toFixed(2).replace(".", ",")}` : "";
                  return (
                    <span key={o.id} className="relative">
                      <button type="button" disabled={out && !n} aria-pressed={n > 0}
                        onClick={() => setDraft({ ...draft, options: tapOption(options, g, o.id) })}
                        onContextMenu={(e) => { e.preventDefault(); setDraft({ ...draft, options: dropOption(options, o.id) }); }}
                        aria-label={`${o.name}${price ? `, ${price} €` : ""}${n > 1 ? `, ${n} φορές` : ""}${out ? ", τελείωσε" : ""}`}
                        style={n ? { backgroundImage: grad(tone), color: tone.ink } : undefined}
                        className={cn("flex min-h-16 w-full items-center gap-2 rounded-xl px-3.5 text-left text-base transition-[background-color,transform] active:scale-[0.98] disabled:opacity-35", n ? "font-semibold" : "bg-card hover:bg-secondary", focus)}>
                        <span className="line-clamp-2 flex-1">{o.name}{out ? <span className="block text-xs text-muted-foreground">Τελείωσε</span> : null}</span>
                        {price ? <span className="text-sm tabular-nums opacity-75">{price}</span> : null}
                      </button>
                      {n ? (
                        <button type="button" onClick={() => setDraft({ ...draft, options: dropOption(options, o.id) })} aria-label={`Βγάλε ένα ${o.name}`}
                          className={cn("absolute -top-2 -right-1.5 flex h-6 min-w-8 items-center justify-center gap-0.5 rounded-full bg-foreground px-1.5 text-xs font-bold text-background tabular-nums", focus)}>
                          {n > 1 ? `× ${n}` : null}<X className="size-3" />
                        </button>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        <label className={cn("block space-y-2", product.groups.length && "border-t border-border pt-5")}>
          <span className="flex items-baseline gap-3"><span className="text-lg font-semibold">Σημείωση</span><span className="text-sm text-muted-foreground">τυπώνεται στην απόδειξη</span></span>
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={80} placeholder="π.χ. χωρίς κουτάλι" data-autofocus={product.groups.length ? undefined : true}
            className="h-12 w-full rounded-xl bg-card px-4 text-base ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
        <Stepper value={draft.quantity} label={product.name} onChange={(quantity) => setDraft({ ...draft, quantity: Math.max(1, quantity) })} />
        <span className="flex-1 text-sm text-muted-foreground tabular-nums">{euro(unit)}{draft.quantity > 1 ? ` × ${draft.quantity}` : ""}</span>
        <button type="button" onClick={onDone} disabled={missing > 0} className={cn(primary, "w-full sm:w-72")}>
          <span>{missing ? `Λείπουν ${missing}` : draft.editKey ? "Ενημέρωση" : "Προσθήκη"}</span>
          <span className="tabular-nums">{euro(unit * draft.quantity)}</span>
        </button>
      </div>
    </Dialog>
  );
}

