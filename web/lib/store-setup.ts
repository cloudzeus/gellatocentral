// Στήσιμο καταστήματος από τον ιδιοκτήτη: πρότυπα, τι φτιάχνεται από ένα «σχέδιο» και πόσο έτοιμο είναι.
// Καθαροί κανόνες, χωρίς βάση. Η εγγραφή είναι στο lib/store-setup-db.ts.
// Mockup: docs/mockups/store-setup/store-setup.html

export type StoreKind = "SHOP_TABLES" | "WORKSHOP" | "VENDING" | "VENDING_STOCK";
export type SpaceKind = "showcase" | "freezer" | "fridge" | "chamber" | "blast" | "vending" | "dry";

/** Είδη χώρων: κάθε ψυγείο είναι συσκευή και αποθήκη μαζί, με όρια θερμοκρασίας για το HACCP. */
export const SPACE: Record<SpaceKind, { label: string; hint: string; temp: [number, number] | null; vending?: true }> = {
  showcase: { label: "Βιτρίνα παγωτού", hint: "Από εδώ πουλά το ταμείο", temp: [-14, -11] },
  freezer: { label: "Καταψύκτης", hint: "Απόθεμα σε λεκάνες", temp: [-22, -18] },
  fridge: { label: "Ψυγείο", hint: "Γλυκά, ποτά, γάλα", temp: [2, 5] },
  chamber: { label: "Θάλαμος συντήρησης", hint: "Πρώτες ύλες", temp: [2, 5] },
  blast: { label: "Blast freezer", hint: "Γρήγορη κατάψυξη μετά την παραγωγή", temp: [-40, -30] },
  vending: { label: "Αυτόματος πωλητής", hint: "Πουλά μόνος του, με κάρτα", temp: [-20, -16], vending: true },
  dry: { label: "Ξηρή αποθήκη", hint: "Κύπελλα, χωνάκια, συσκευασίες", temp: null },
};
export const SPACE_ORDER = Object.keys(SPACE) as SpaceKind[];

export type Zone = { name: string; prefix: string; count: number; seats: number };
export type Plan = {
  spaces: Record<SpaceKind, number>;
  tills: number; // κεντρικά ταμεία Android (Viva POS)
  handhelds: number; // φορητά ταμεία Android για τα τραπέζια
  receiptPrinters: number;
  orderPrinters: number;
  zones: Zone[];
};

const none: Record<SpaceKind, number> = { showcase: 0, freezer: 0, fridge: 0, chamber: 0, blast: 0, vending: 0, dry: 0 };

/** Τα τέσσερα πρότυπα, από τα σημεία του πρώτου πελάτη (docs/analysis/BETA-CUSTOMER.md). */
export const TEMPLATES: Record<StoreKind, { label: string; example: string; lines: string[]; plan: Plan }> = {
  SHOP_TABLES: {
    label: "Κατάστημα με τραπέζια", example: "Όπως η Δορυλαίου",
    lines: ["1 κεντρικό ταμείο", "Βιτρίνα, 2 καταψύκτες, ψυγείο", "Τραπέζια και κρατήσεις", "Εκτυπωτές αποδείξεων και παραγγελιών"],
    plan: { spaces: { ...none, showcase: 1, freezer: 2, fridge: 1, dry: 1 }, tills: 1, handhelds: 1, receiptPrinters: 1, orderPrinters: 1, zones: [{ name: "Σάλα", prefix: "", count: 8, seats: 4 }] },
  },
  WORKSHOP: {
    label: "Εργαστήριο και χονδρική", example: "Όπως ο Πειραιάς",
    lines: ["Ταμείο λιανικής", "Blast freezer, θάλαμος, καταψύκτες", "Τροφοδοτεί τα άλλα σημεία", "Αυτόματος πωλητής"],
    plan: { spaces: { ...none, showcase: 1, freezer: 2, chamber: 1, blast: 1, vending: 1, dry: 1 }, tills: 1, handhelds: 0, receiptPrinters: 1, orderPrinters: 0, zones: [] },
  },
  VENDING: {
    label: "Μόνο αυτόματος πωλητής", example: "Όπως το αεροδρόμιο",
    lines: ["1 πωλητής, −20 / −16 °C", "Γεμίζει από άλλο σημείο", "Χωρίς ταμείο, χωρίς τραπέζια"],
    plan: { spaces: { ...none, vending: 1 }, tills: 0, handhelds: 0, receiptPrinters: 0, orderPrinters: 0, zones: [] },
  },
  VENDING_STOCK: {
    label: "Πωλητής με αποθήκη", example: "Όπως η Τήνος",
    lines: ["1 πωλητής", "2 καταψύκτες αποθέματος", "Χωρίς ταμείο, χωρίς τραπέζια"],
    plan: { spaces: { ...none, vending: 1, freezer: 2 }, tills: 0, handhelds: 0, receiptPrinters: 0, orderPrinters: 0, zones: [] },
  },
};
export const KIND_ORDER = Object.keys(TEMPLATES) as StoreKind[];

export const LIMITS = { space: 20, devices: 10, printers: 10, zones: 8, tablesPerZone: 60, seats: 20 };

/** Τι πρέπει να διορθωθεί στο σχέδιο πριν φτιαχτεί· κενή λίστα = εντάξει. */
export function planProblems(p: Plan): string[] {
  const out: string[] = [];
  const int = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!SPACE_ORDER.every((k) => int(p.spaces[k], LIMITS.space))) out.push(`Έως ${LIMITS.space} από κάθε είδος χώρου`);
  if (!int(p.tills, LIMITS.devices) || !int(p.handhelds, LIMITS.devices)) out.push(`Έως ${LIMITS.devices} ταμεία από κάθε είδος`);
  if (!int(p.receiptPrinters, LIMITS.printers) || !int(p.orderPrinters, LIMITS.printers)) out.push(`Έως ${LIMITS.printers} εκτυπωτές από κάθε είδος`);
  if (p.zones.length > LIMITS.zones) out.push(`Έως ${LIMITS.zones} ζώνες τραπεζιών`);
  for (const z of p.zones) {
    if (!z.name.trim()) out.push("Κάθε ζώνη θέλει όνομα");
    if (!int(z.count, LIMITS.tablesPerZone) || z.count < 1) out.push(`Η ζώνη «${z.name}» θέλει από 1 έως ${LIMITS.tablesPerZone} τραπέζια`);
    if (!int(z.seats, LIMITS.seats) || z.seats < 1) out.push(`Η ζώνη «${z.name}» θέλει από 1 έως ${LIMITS.seats} θέσεις`);
  }
  const names = expand(p).tables.map((t) => t.name);
  if (new Set(names).size !== names.length) out.push("Δύο ζώνες δίνουν ίδια ονόματα τραπεζιών. Άλλαξε το πρόθεμα της μίας (π.χ. Ε για το πεζοδρόμιο)");
  if (p.handhelds > 0 && p.zones.length === 0) out.push("Τα φορητά ταμεία είναι για τα τραπέζια. Πρόσθεσε ζώνη τραπεζιών ή βγάλε τα φορητά");
  if (p.orderPrinters > 0 && p.zones.length === 0) out.push("Ο εκτυπωτής παραγγελιών τυπώνει ό,τι στέλνεται από τα τραπέζια. Πρόσθεσε ζώνη τραπεζιών ή βγάλε τον εκτυπωτή");
  if (p.tills + p.handhelds > 0 && SPACE_ORDER.every((k) => k === "dry" || p.spaces[k] === 0)) out.push("Το ταμείο χρειάζεται τουλάχιστον έναν χώρο να πουλά από (π.χ. βιτρίνα)");
  if (SPACE_ORDER.every((k) => p.spaces[k] === 0) && p.tills === 0) out.push("Το σημείο δεν έχει ούτε χώρο ούτε ταμείο");
  return out;
}

const numbered = (label: string, n: number) => Array.from({ length: n }, (_, i) => (n > 1 ? `${label} ${i + 1}` : label));

/** Τι ακριβώς θα φτιαχτεί από το σχέδιο, με ονόματα. Το πρώτο «πουλήσιμο» ψυγείο γίνεται η αποθήκη των ταμείων. */
export function expand(p: Plan) {
  const spaces = SPACE_ORDER.flatMap((k) => numbered(SPACE[k].label, p.spaces[k]).map((name) => ({ kind: k, name, temp: SPACE[k].temp, vending: !!SPACE[k].vending })));
  const sellFrom = spaces.find((s) => s.kind === "showcase") ?? spaces.find((s) => !s.vending && s.kind !== "dry") ?? null;
  const tills = [
    ...numbered("Κεντρικό ταμείο", p.tills).map((name) => ({ name, handheld: false })),
    ...numbered("Φορητό ταμείο", p.handhelds).map((name) => ({ name, handheld: true })),
  ];
  const printers = [
    ...numbered("Εκτυπωτής αποδείξεων", p.receiptPrinters).map((name) => ({ name, role: "RECEIPTS" as const })),
    ...numbered("Εκτυπωτής παραγγελιών", p.orderPrinters).map((name) => ({ name, role: "ORDERS" as const })),
  ];
  let position = 0;
  const tables = p.zones.flatMap((z) => Array.from({ length: z.count }, (_, i) => ({ name: `${z.prefix.trim()}${i + 1}`, zone: z.name.trim(), seats: z.seats, position: position++ })));
  return { spaces, sellFrom: sellFrom?.name ?? null, tills, printers, tables };
}

/** Η πρώτη ελεύθερη σειρά αποδείξεων ταμείου (λατινικά, έως 6), π.χ. P1, P2… */
export function freeSeries(taken: Iterable<string | null>, count: number) {
  const used = new Set([...taken].filter(Boolean));
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) if (!used.has(`P${n}`)) out.push(`P${n}`);
  return out;
}

// ---- Ετοιμότητα ----

export type Tone = "ok" | "wait" | "bad";
export type Check = { key: string; tone: Tone; title: string; detail: string; action?: { kind: "pair" | "viva" | "printer" | "link"; id?: string; href?: string; label: string } };
export type ReadyInput = {
  issuer: { name: string; viva: boolean; mydata: boolean };
  products: number;
  tills: { id: string; name: string; series: string | null; vivaTerminalId: string | null; pairedAt: Date | null; pairCodeLive: boolean }[];
  printers: { id: string; name: string; role: "RECEIPTS" | "ORDERS"; connection: "NETWORK" | "BLUETOOTH" | "USB"; address: string | null }[];
  coldDevices: { name: string; vending: boolean; tempMin: number | null; tempMax: number | null; lastReadingAt: Date | null }[];
  tables: number;
  zones: number;
};

const STALE_MS = 30 * 60_000;

export function readiness(r: ReadyInput, now = new Date()) {
  const sale: Check[] = [];
  if (r.tills.length) {
    sale.push(r.issuer.mydata
      ? { key: "issuer", tone: "ok", title: "Εκδότης αποδείξεων", detail: `${r.issuer.name} · με κλειδιά myDATA` }
      : { key: "issuer", tone: "bad", title: "Εκδότης αποδείξεων", detail: `${r.issuer.name}: λείπουν τα κλειδιά myDATA. Τα βάζει η υποστήριξη`, action: { kind: "link", href: "/company/issuers", label: "Εκδότες" } });
    sale.push(r.products > 0
      ? { key: "catalog", tone: "ok", title: "Κατάλογος και τιμές", detail: `${r.products} ενεργά προϊόντα` }
      : { key: "catalog", tone: "bad", title: "Κατάλογος και τιμές", detail: "Δεν υπάρχει κανένα προϊόν για να πουλήσει το ταμείο", action: { kind: "link", href: "/products", label: "Προϊόντα" } });
  }
  for (const t of r.tills) {
    sale.push(t.pairedAt
      ? { key: `pair-${t.id}`, tone: "ok", title: `${t.name} · σύνδεση`, detail: `Συνδέθηκε ${t.pairedAt.toLocaleDateString("el-GR", { timeZone: "Europe/Athens" })} · σειρά ${t.series ?? "—"}`, action: { kind: "pair", id: t.id, label: "Νέα σύνδεση" } }
      : { key: `pair-${t.id}`, tone: "wait", title: `${t.name} · σύνδεση`, detail: t.pairCodeLive ? "Σκάναρε το QR από τη συσκευή Android" : "Δεν έχει συνδεθεί. Βγάλε QR και σκάναρέ το από τη συσκευή", action: { kind: "pair", id: t.id, label: t.pairCodeLive ? "Νέο QR" : "QR σύνδεσης" } });
    sale.push(t.vivaTerminalId
      ? { key: `viva-${t.id}`, tone: "ok", title: `${t.name} · κάρτες Viva`, detail: `Τερματικό ${t.vivaTerminalId}`, action: { kind: "viva", id: t.id, label: "Αλλαγή" } }
      : { key: `viva-${t.id}`, tone: r.issuer.viva ? "bad" : "wait", title: `${t.name} · κάρτες Viva`, detail: r.issuer.viva ? "Χωρίς τερματικό δέχεται μόνο μετρητά. Γράψε το Terminal ID (TID) από την οθόνη του Viva POS" : "Ο εκδότης δεν έχει ακόμα λογαριασμό Viva. Μέχρι τότε μόνο μετρητά", action: { kind: "viva", id: t.id, label: "Terminal ID" } });
  }
  for (const p of r.printers) {
    const ready = p.connection === "USB" || !!p.address;
    const where = p.connection === "NETWORK" ? `Δίκτυο ${p.address}` : p.connection === "BLUETOOTH" ? `Bluetooth ${p.address}` : "USB, στο ταμείο";
    sale.push(ready
      ? { key: `printer-${p.id}`, tone: "ok", title: p.name, detail: where, action: { kind: "printer", id: p.id, label: "Αλλαγή" } }
      : { key: `printer-${p.id}`, tone: "wait", title: p.name, detail: p.role === "ORDERS" ? "Γράψε πώς συνδέεται, για να τυπώνει τις παραγγελίες των τραπεζιών" : "Γράψε πώς συνδέεται, για να τυπώνει αποδείξεις", action: { kind: "printer", id: p.id, label: "Σύνδεση" } });
  }

  const cold: Check[] = [];
  if (r.coldDevices.length) {
    const noLimits = r.coldDevices.filter((d) => d.tempMin === null || d.tempMax === null);
    cold.push(noLimits.length
      ? { key: "limits", tone: "bad", title: "Όρια θερμοκρασίας", detail: `Χωρίς όρια: ${noLimits.map((d) => d.name).join(", ")}`, action: { kind: "link", href: "/devices", label: "Συσκευές" } }
      : { key: "limits", tone: "ok", title: "Όρια θερμοκρασίας", detail: `Και τα ${r.coldDevices.length} έχουν όρια από το είδος τους` });
    const live = r.coldDevices.filter((d) => d.lastReadingAt && now.getTime() - d.lastReadingAt.getTime() <= STALE_MS).length;
    cold.push(live === r.coldDevices.length
      ? { key: "sensors", tone: "ok", title: "Αισθητήρες θερμοκρασίας", detail: `Στέλνουν και οι ${live}` }
      : { key: "sensors", tone: "wait", title: "Αισθητήρες θερμοκρασίας", detail: `${live} από ${r.coldDevices.length} στέλνουν μετρήσεις · μέχρι τότε καταγραφή με το χέρι στο HACCP`, action: { kind: "link", href: "/haccp", label: "HACCP" } });
  }

  const tables: Check[] = r.tables
    ? [{ key: "tables", tone: "ok", title: `${r.tables} τραπέζια σε ${r.zones} ${r.zones === 1 ? "ζώνη" : "ζώνες"}`, detail: "Φαίνονται στο ταμείο μαζί με τις κρατήσεις" }]
    : [];

  const groups = [
    { key: "sale", title: "Πώληση και συσκευές", checks: sale },
    { key: "cold", title: "Ψυγεία (HACCP)", checks: cold },
    { key: "tables", title: "Τραπέζια", checks: tables },
  ].filter((g) => g.checks.length);
  const all = groups.flatMap((g) => g.checks);
  const count = (tone: Tone, list = all) => list.filter((c) => c.tone === tone).length;
  // Πουλά = έχει εκδότη με myDATA, προϊόντα και τουλάχιστον ένα συνδεδεμένο ταμείο
  const canSell = r.tills.length > 0 && r.issuer.mydata && r.products > 0 && r.tills.some((t) => t.pairedAt);
  return { groups: groups.map((g) => ({ ...g, ok: count("ok", g.checks), wait: count("wait", g.checks), bad: count("bad", g.checks) })), ok: count("ok"), total: all.length, canSell };
}
