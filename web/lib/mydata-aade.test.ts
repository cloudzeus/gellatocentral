import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AadeMyDataProvider, aadeProviderForOrganization, buildAadeInvoice,
  type AadeOrganizationConfig, type AadeProviderDependencies,
} from "./mydata-aade.ts";
import { DisabledMyDataProvider, type MyDataSubmission } from "./mydata-outgoing.ts";

const MARK = "400000000000001";
const UID = "a".repeat(40);
const QR = "https://mydata.example.test/qr/abc";
const EMPTY = '<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"></RequestedDoc>';
const DIMENSIONS = new Map([["item-1", "mass"], ["item-2", "count"], ["item-3", "volume"]]);

function submission(overrides: Partial<MyDataSubmission> = {}): MyDataSubmission {
  return {
    idempotencyKey: "0e1c7ee4-2cd4-4cf0-931f-76926a4a0818",
    docType: "1.1",
    series: "A",
    aa: 101,
    issuedAt: new Date("2026-11-23T22:30:00.000Z"),
    customer: { id: "customer-1", name: "Πελάτης ΑΕ", vatNumber: "EL888888888", countryCode: "GR", address: "Οδός 1", city: "Ηράκλειο", postalCode: "71001" },
    lines: [{ genericItemId: "item-1", lotId: null, quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 24 }],
    netCents: 2000,
    vatCents: 480,
    totalCents: 2480,
    ...overrides,
  };
}

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/xml" } });
}

function success(mark = MARK, uid = UID, qr = QR): string {
  return `<ResponseDoc><response><invoiceUid>${uid}</invoiceUid><invoiceMark>${mark}</invoiceMark><qrUrl>${qr}</qrUrl><statusCode>Success</statusCode></response></ResponseDoc>`;
}

function transmitted(overrides: { series?: string; mark?: string; uid?: string; qr?: string; cancelledByMark?: string } = {}): string {
  return `<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"><invoicesDoc><invoice>
    <mark>${overrides.mark ?? MARK}</mark>${overrides.cancelledByMark ? `<cancelledByMark>${overrides.cancelledByMark}</cancelledByMark>` : ""}
    <issuer><vatNumber>999999999</vatNumber><country>GR</country><branch>0</branch></issuer>
    <counterpart><vatNumber>888888888</vatNumber><country>GR</country><branch>0</branch></counterpart>
    <invoiceHeader><series>${overrides.series ?? "A"}</series><aa>101</aa><issueDate>2026-11-24</issueDate><invoiceType>1.1</invoiceType></invoiceHeader>
  </invoice></invoicesDoc></RequestedDoc>`
    .replace("</invoice>", `<uid>${overrides.uid ?? UID}</uid><qrCodeUrl>${overrides.qr ?? QR}</qrCodeUrl></invoice>`);
}

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

function provider(fetcher: typeof fetch, extra: Partial<AadeProviderDependencies> = {}): AadeMyDataProvider {
  return new AadeMyDataProvider(
    { orgId: "org-1", issuerVat: "999999999", userId: "test-user", subscriptionKey: "test-subscription-secret" },
    { fetch: fetcher, environment: "sandbox", loadDimensions: async () => DIMENSIONS, timeoutMs: 100, ...extra },
  );
}

function organization(overrides: Partial<AadeOrganizationConfig> = {}): AadeOrganizationConfig {
  return { id: "org-1", vatNumber: "999999999", aadeUserId: "user", aadeSubKey: "key", ...overrides };
}

test("ελλιπή ή μερικά tenant credentials επιλέγουν Disabled provider", async () => {
  const cases = [null, organization({ aadeUserId: null }), organization({ aadeSubKey: "  " }), organization({ id: "other-org" })];
  for (const config of cases) {
    const selected = aadeProviderForOrganization("org-1", config);
    assert.equal(selected.constructor, DisabledMyDataProvider);
    await assert.rejects(selected.submit(submission()), /Δεν έχει ρυθμιστεί πάροχος/);
  }
  assert.ok(aadeProviderForOrganization("org-1", organization()) instanceof AadeMyDataProvider);
});

test("canonical XML: escaping, Athens ημερομηνία, σειρά XSD, ακέραια ποσά και deterministic output", () => {
  const input = submission({
    series: 'A&<"Χ',
    customer: { name: "Δεν στέλνεται σε GR", vatNumber: "888888888", countryCode: "GR", address: "Οδός & <Κεντρική>", city: "Ηράκλειο", postalCode: "71001" },
    lines: [
      { genericItemId: "item-1", lotId: null, quantityBase: 1_500_000, unitPriceCents: 1000, vatRate: 24 },
      { genericItemId: "item-2", lotId: null, quantityBase: 2, unitPriceCents: 50_000, vatRate: 24 },
    ],
    netCents: 1600,
    vatCents: 384,
    totalCents: 1984,
  });
  const first = buildAadeInvoice(input, "EL999999999", DIMENSIONS);
  const second = buildAadeInvoice(input, "999999999", DIMENSIONS);
  assert.equal(first.xml, second.xml);
  assert.equal(first.issueDate, "2026-11-24");
  assert.ok(first.xml.includes("<series>A&amp;&lt;&quot;Χ</series>"));
  assert.ok(first.xml.includes("<street>Οδός &amp; &lt;Κεντρική&gt;</street>"));
  assert.ok(first.xml.includes("<quantity>1.5</quantity>"));
  assert.ok(first.xml.includes("<measurementUnit>2</measurementUnit>"));
  assert.ok(first.xml.includes("<quantity>2</quantity>"));
  assert.ok(first.xml.includes("<measurementUnit>1</measurementUnit>"));
  assert.ok(first.xml.includes("<totalNetValue>16.00</totalNetValue>"));
  assert.ok(first.xml.includes("<totalVatAmount>3.84</totalVatAmount>"));
  assert.ok(first.xml.includes("<totalGrossValue>19.84</totalGrossValue>"));
  assert.ok(!first.xml.includes("itemDescr"));
  assert.ok(!first.xml.includes("Δεν στέλνεται"));
  assert.ok(!first.xml.includes(input.idempotencyKey));
  const order = ["<issuer>", "<counterpart>", "<invoiceHeader>", "<invoiceDetails>", "<invoiceSummary>"];
  assert.deepEqual(order.map((tag) => first.xml.indexOf(tag)), order.map((tag) => first.xml.indexOf(tag)).sort((a, b) => a - b));
  assert.ok(first.xml.indexOf("<currency>EUR</currency>") < first.xml.indexOf("</invoiceHeader>"));
  assert.ok(first.xml.indexOf("<lineNumber>1</lineNumber>") < first.xml.indexOf("<quantity>1.5</quantity>"));
  assert.ok(first.xml.indexOf("<quantity>1.5</quantity>") < first.xml.indexOf("<netValue>15.00</netValue>"));
});

test("5.1 γράφει correlatedInvoices μετά το currency και 9.3 απορρίπτεται χωρίς δίκτυο", async () => {
  const credit = submission({ docType: "5.1", relatedMark: MARK });
  const built = buildAadeInvoice(credit, "999999999", DIMENSIONS);
  assert.ok(built.xml.indexOf("<currency>EUR</currency>") < built.xml.indexOf(`<correlatedInvoices>${MARK}</correlatedInvoices>`));
  const { calls, fetcher } = mockFetch(() => xml(EMPTY));
  await assert.rejects(provider(fetcher).submit(submission({ docType: "9.3" })), /στοιχεία διακίνησης/);
  assert.equal(calls.length, 0);
});

test("5.1 χωρίς MARK, ΦΠΑ 0%, ασύμφωνα σύνολα και άγνωστο είδος απορρίπτονται πριν από fetch", async () => {
  const cases = [
    { input: submission({ docType: "5.1" }), expected: /Συσχετιζόμενο MARK/, dimensions: DIMENSIONS },
    { input: submission({ lines: [{ genericItemId: "item-1", lotId: null, quantityBase: 2_000_000, unitPriceCents: 1000, vatRate: 0 }], vatCents: 0, totalCents: 2000 }), expected: /κατηγορία απαλλαγής/, dimensions: DIMENSIONS },
    { input: submission({ totalCents: 9999 }), expected: /δεν συμφωνούν/, dimensions: DIMENSIONS },
    { input: submission(), expected: /tenant-scoped/, dimensions: new Map<string, string>() },
  ];
  for (const entry of cases) {
    const { calls, fetcher } = mockFetch(() => xml(EMPTY));
    await assert.rejects(provider(fetcher, { loadDimensions: async () => entry.dimensions }).submit(entry.input), entry.expected);
    assert.equal(calls.length, 0);
  }
});

test("SendInvoices success επιστρέφει μόνο πραγματικά MARK, UID και validated QR", async () => {
  const { calls, fetcher } = mockFetch((call) => xml(call.init?.method === "POST" ? success() : EMPTY));
  const receipt = await provider(fetcher).submit(submission());
  assert.deepEqual(receipt, { mark: MARK, uid: UID, qrUrl: QR });
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 1);
  assert.equal(calls[0]!.init?.method, "GET");
  assert.ok(calls[0]!.url.startsWith("https://mydataapidev.aade.gr/RequestTransmittedDocs?"));
  assert.ok(calls[0]!.url.includes("mark=0"));
  assert.ok(calls[0]!.url.includes("dateFrom=24%2F11%2F2026"));
  assert.equal(calls[1]!.url, "https://mydataapidev.aade.gr/SendInvoices");
  assert.equal(calls[1]!.init?.redirect, "error");
  assert.equal(calls[1]!.init?.cache, "no-store");
  assert.ok(calls[1]!.init?.signal);
  assert.equal(String(calls[1]!.init?.body).includes("receiptReference"), false);
  assert.equal(calls[1]!.init?.headers && new Headers(calls[1]!.init.headers).get("aade-user-id"), "test-user");
});

test("Success χωρίς MARK δεν παράγει ψεύτικο receipt", async () => {
  const { calls, fetcher } = mockFetch((call, index) => xml(index === 1 ? `<ResponseDoc><response><invoiceUid>${UID}</invoiceUid><statusCode>Success</statusCode></response></ResponseDoc>` : EMPTY));
  await assert.rejects(provider(fetcher).submit(submission()), /αβέβαιη.*reconciliation/);
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 1);
  assert.equal(calls.length, 3);
});

test("ValidationError και TechnicalError κρατούν μόνο ασφαλή status/codes", async () => {
  for (const status of ["ValidationError", "TechnicalError"]) {
    const { calls, fetcher } = mockFetch((call) => xml(call.init?.method === "POST"
      ? `<ResponseDoc><response><errors><error><message>secret test-subscription-secret &lt;raw&gt;</message><code>E-42</code></error></errors><statusCode>${status}</statusCode></response></ResponseDoc>`
      : EMPTY));
    await assert.rejects(provider(fetcher).submit(submission()), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, new RegExp(status));
      assert.match(message, /E-42/);
      assert.ok(!message.includes("secret"));
      assert.ok(!message.includes("test-subscription-secret"));
      assert.ok(!message.includes("raw"));
      return true;
    });
    assert.equal(calls.length, 2);
  }
});

test("timeout μετά το POST κάνει reconciliation και ποτέ δεύτερο POST", async () => {
  const { calls, fetcher } = mockFetch((_call, index) => {
    if (index === 1) throw new DOMException("private timeout detail", "TimeoutError");
    return xml(EMPTY);
  });
  await assert.rejects(provider(fetcher).submit(submission()), (error: unknown) => {
    assert.match(error instanceof Error ? error.message : "", /αβέβαιη/);
    assert.ok(!(error instanceof Error ? error.message : "").includes("private"));
    return true;
  });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 1);
});

test("retry μετά από network failure ανακτά uid/mark/qrCodeUrl χωρίς νέο POST", async () => {
  const { calls, fetcher } = mockFetch((_call, index) => {
    if (index === 1) throw new TypeError("socket secret");
    return xml(index === 3 ? transmitted() : EMPTY);
  });
  const selected = provider(fetcher);
  // Στο πρώτο attempt το post-error GET είναι κενό· στο retry το preflight βρίσκει το invoice.
  await assert.rejects(selected.submit(submission()), /αβέβαιη/);
  const receipt = await selected.submit(submission());
  assert.deepEqual(receipt, { mark: MARK, uid: UID, qrUrl: QR });
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 1);
  assert.equal(calls.length, 4);
});

test("preflight reconciliation βρίσκει υπάρχον invoice και δεν στέλνει POST", async () => {
  const { calls, fetcher } = mockFetch(() => xml(transmitted()));
  const receipt = await provider(fetcher).submit(submission());
  assert.deepEqual(receipt, { mark: MARK, uid: UID, qrUrl: QR });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init?.method, "GET");
});

test("namespace prefixes και XML entities ταιριάζουν στο reconciliation", async () => {
  const input = submission({ series: "A&B" });
  const body = transmitted({ series: "A&amp;B", qr: "https://mydata.example.test/qr?a=1&amp;b=2" })
    .replaceAll("<RequestedDoc", "<ns:RequestedDoc").replaceAll("</RequestedDoc>", "</ns:RequestedDoc>")
    .replace(/<(\/?)(mark|uid|qrCodeUrl|invoicesDoc|invoice|issuer|counterpart|invoiceHeader|vatNumber|country|branch|series|aa|issueDate|invoiceType)>/g, "<$1ns:$2>");
  const { calls, fetcher } = mockFetch(() => xml(body));
  const receipt = await provider(fetcher).submit(input);
  assert.equal(receipt.mark, MARK);
  assert.equal(receipt.qrUrl, "https://mydata.example.test/qr?a=1&b=2");
  assert.equal(calls.length, 1);
});

test("concurrent ίδιο idempotency key μοιράζεται μία εκτέλεση", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { calls, fetcher } = mockFetch(async (call, index) => {
    if (index === 0) await gate;
    return xml(call.init?.method === "POST" ? success() : EMPTY);
  });
  const selected = provider(fetcher);
  const first = selected.submit(submission());
  const second = selected.submit(submission());
  assert.equal(first, second);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.init?.method === "POST").length, 1);
});

test("υπερβολικά μεγάλο response ακυρώνεται και εμποδίζει POST", async () => {
  const { calls, fetcher } = mockFetch(() => new Response("<RequestedDoc></RequestedDoc>", { status: 200, headers: { "content-length": "1000" } }));
  await assert.rejects(provider(fetcher, { maxResponseBytes: 100 }).submit(submission()), /επιτρεπτό όριο/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init?.method, "GET");
});

test("unbounded pagination δεν επιτρέπει νέο POST", async () => {
  const page = '<RequestedDoc><continuationToken><nextPartitionKey>p</nextPartitionKey><nextRowKey>r</nextRowKey></continuationToken></RequestedDoc>';
  const { calls, fetcher } = mockFetch(() => xml(page));
  await assert.rejects(provider(fetcher, { maxReconciliationPages: 1 }).submit(submission()), /όριο σελίδων/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init?.method, "GET");
});

test("ακυρωμένη αντίστοιχη διαβίβαση απαιτεί έλεγχο και όχι νέο POST", async () => {
  const { calls, fetcher } = mockFetch(() => xml(transmitted({ cancelledByMark: "400000000000002" })));
  await assert.rejects(provider(fetcher).submit(submission()), /ακυρωμένη.*χειροκίνητος έλεγχος/);
  assert.equal(calls.length, 1);
});
