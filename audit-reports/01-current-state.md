# 01 · Τρέχουσα κατάσταση

Audit της 28/11/2026, πάνω στο `master` (τελευταίο commit `ebd777b`) μαζί με τις αλλαγές που δεν έχουν γίνει commit (επιστροφές και πιστωτικά προμηθευτών). Δεν άλλαξε καθόλου κώδικας, schema ή δεδομένα.

## 1. Πώς έγινε ο έλεγχος

| Έλεγχος | Αποτέλεσμα |
|-|-|
| Ανάγνωση `README.md`, `web/AGENTS.md`, `docs/analysis/*`, `docs/audit/*` (προηγούμενο τεχνικό audit, σχέδιο διόρθωσης, ημερολόγιο υλοποίησης) | Έγινε |
| `prisma/schema.prisma`: 176 models, 100 migrations | Διαβάστηκε όλο σε επίπεδο πεδίων |
| Pages (`app/(app)`, ~110), API routes (51), `lib/` (~200 modules), `mobile/` | Χαρτογραφήθηκαν, με στοχευμένη ανάγνωση των κρίσιμων |
| `npm test` (unit, `node --test`) | **667/667 πέρασαν** (5,2 δευτ.) |
| `npx tsc --noEmit` | **Χωρίς σφάλματα**, μαζί με τις αλλαγές που δεν έχουν γίνει commit |
| `npm run test:integration` (25 αρχεία) | **Δεν έτρεξε**: θέλει τοπική βάση `_test`. Ό,τι στηρίζεται μόνο σε integration test σημειώνεται ως «test υπάρχει, δεν ξανατρέχτηκε» |
| Πραγματικές κλήσεις Viva/ΑΑΔΕ | **Καμία** (κανόνας του audit) |
| Επίσημες προδιαγραφές ΑΑΔΕ/Viva | Δεν ξαναδιαβάστηκαν online σε αυτό το audit. Χρησιμοποιήθηκε η τεκμηρίωση Viva Fiscalisation του skill και τα σχόλια του κώδικα. Ό,τι αφορά φορολογικό σενάριο θέλει επιβεβαίωση από λογιστή ή Viva |

## 2. Αρχιτεκτονική και πραγματικές εκδόσεις

| Στοιχείο | Πραγματικό | Λίστα απαιτήσεων |
|-|-|-|
| Web | Next.js **16.4.5**, App Router, React 19, `cacheComponents`, `output: standalone` | Next.js |
| ORM | Prisma **7.10** με `@prisma/adapter-pg` | Prisma |
| Βάση | **PostgreSQL 16 + pgvector** (για τη βάση γνώσης/AI) | MySQL: **διαφορά**. Δεν προτείνεται αλλαγή: όλο το schema, τα κλειδώματα (`SELECT … FOR UPDATE`) και τα migrations είναι Postgres |
| UI | Tailwind 4, shadcn/ui, ελληνικά, fluid typography | — |
| Validation / tests | zod 4 · `node --test` + `tsx --test` για integration | — |
| Android ταμείο | React Native / Expo (`mobile/`): ταμείο, παραγγελίες, κρατήσεις, βάρδιες, συναλλαγές, ουρά χωρίς σύνδεση | — |
| Deploy | Coolify, Dockerfile στο `web/`, `prisma migrate deploy` σε κάθε εκκίνηση· CI στο `.github/workflows/ci.yml` (typecheck, lint, unit, migrations, drift, integration, build) | — |
| Ποσά | Ακέραια λεπτά (`*Cents`) και εκατοστά λεπτού για κόστος (`*Hundredths`), ΦΠΑ σε basis points/ακέραια ποσοστά | Decimal ή minor units: **καλύπτεται** |

### Μοντέλο tenant

`Organization` = συνδρομητής (tenant). Μέσα του `LegalEntity` = εκδότης με δικό του ΑΦΜ και δικά του κλειδιά Viva/myDATA, `Store` = κατάστημα δεμένο σε εκδότη, `Warehouse` = αποθήκη/ψυγείο/εργαστήριο, `Device` = ταμείο/KDS/ψυγείο/ζυγαριά. Κάθε επιχειρησιακός πίνακας έχει `orgId`. Τα δικαιώματα είναι ανά ρόλο (`OrgRole`), ομάδα (`OrgGroup`), κατάστημα (`MembershipStore`) και αποθήκη (`MembershipWarehouse`). Οι κλειδιά δικαιωμάτων ορίζονται στο `lib/permissions.ts:67`. Ξεχωριστοί ρόλοι πλατφόρμας: `SUPER_ADMIN/MANAGER/STAFF/SUPPORT`, με είσοδο υποστήριξης (impersonation) που γράφεται στο ιστορικό.

## 3. Integrations

| Σύστημα | Τι κάνει | Πού | Κατάσταση |
|-|-|-|-|
| Viva Cloud Terminal / inter-app (Android) | Χρέωση κάρτας, Abort Session, επιστροφές | `lib/viva/cloud-terminal.ts`, `mobile/viva.ts`, `app/api/pos/sales/*` | Δοκιμάστηκε χειροκίνητα σε demo (Πειραιάς A1/A3, 27/11)· contract tests με fixtures |
| Viva Fiscalisation (receipts:sign, ISV) | Αποδείξεις λιανικής, 8.6, 11.4, 1.1/5.1/9.3 | `lib/viva/fiscal.ts`, `lib/viva/sign.ts`, `lib/mydata-viva.ts`, `lib/order-slips.ts` | Ενεργό· demo |
| ΑΑΔΕ myDATA ERP API (απευθείας) | `SendInvoices` ως εναλλακτικός πάροχος, `RequestTransmittedDocs`, `RequestMyIncome` | `lib/mydata-aade.ts`, `lib/mydata-income.ts`, `lib/mydata-parse.ts` | Ενεργό με κλειδιά ανά εκδότη |
| Viva Smart Checkout + webhook | Συνδρομές SaaS | `lib/billing.ts`, `app/api/webhooks/viva/route.ts` (χωρίς υπογραφή από Viva· επαλήθευση με ερώτημα στη Viva) | Ενεργό |
| Yeastar PBX | Εισερχόμενες κλήσεις, αναγνώριση πελάτη | `app/api/webhooks/yeastar/[id]` | Ενεργό |
| efood / Wolt | Παραγγελίες ως `Order` με `source`, μεταφορά σε λογαριασμό | `lib/orders.ts:198`, `company/connections` | **Χωρίς webhook εισαγωγής**· μόνο χειροκίνητη/τηλεφωνική καταχώριση και ρυθμίσεις σύνδεσης |
| VIES / ΑΑΔΕ ΑΦΜ | Έλεγχος ΑΦΜ | `app/api/vat-lookup`, `VatCheck` | Ενεργό |
| Bunny storage | Αρχεία | `lib/storage/bunny.ts` | Ενεργό |
| OpenRouter (AI) | OCR τιμολογίων, βάση γνώσης υποστήριξης, εμπλουτισμός καταλόγου | `lib/ai/*` | Ενεργό, με χρέωση χρήσης (`UsageEvent`) |

## 4. Modules που λειτουργούν (με κύριες οντότητες)

| Περιοχή | Οθόνες | Κύρια models | Tests |
|-|-|-|-|
| Ταμείο λιανικής/τραπέζια | `/pos`, `/receipts`, Android | `Sale`, `SaleLine`, `Payment`, `Bill`, `BillRound`, `BillLine`, `BillShare`, `DiningTable`, `Reservation`, `TillShift`, `TillDayClose` | `bill.test.ts`, `pos-modifiers.test.ts`, `reservation.test.ts`, `pos-api.integration.ts`, mobile `*.test.ts` |
| Φορολογικά | `/transmissions`, `/company/issuers`, `/company/series` | `FiscalDocument`, `FiscalAttempt`, `DocumentSeries`, `DocumentType`, `LegalEntity` | `mydata-*.test.ts`, `viva/fiscal.test.ts`, `fiscal-retry.test.ts` |
| Παραγγελίες off-premise | `/orders` (POS), Android | `Order`, `OrderLine`, `Call`, `Integration` | `order.test.ts` |
| Χονδρική | `/wholesale-orders/*`, `/invoices`, `/b2b/[token]` | `PriceList*`, `WholesaleQuote*`, `WholesaleOrder*`, `SalesDocument*`, `CustomerPayment*`, `DeliveryRoute/Stop`, `B2bAccess` | `wholesale*.integration.ts` |
| Αγορές | `/orders` (αγορές), `/orders/mrp`, `/orders/rfqs`, `/purchases`, `/my-data` | `PurchaseOrder*`, `PurchaseReceipt*`, `PurchaseDoc`, `PurchaseLine`, `PurchaseInvoice*`, `Rfq*`, `MrpItemSetting`, `SupplierItem*` | `procurement-*.integration.ts`, `invoice-match.test.ts`, `purchase-*.test.ts` |
| Αποθήκη | `/inventory/*`, `/counts`, `/traceability` | `StockMovement`, `StockLot`, `StockCount*`, `StockTransfer*`, `StockThreshold` | 6 `stock-*.integration.ts`, πολλά unit |
| Παραγωγή/συνταγές/HACCP | `/recipes`, `/production/*`, `/haccp` | `Recipe`, `RecipeItem`, `RecipeVersion`, `ProductionBatch*`, `ProductionPlan`, `ProductionDayClose`, `Machine*`, `Haccp*`, `Composition` | `recipe-graph.test.ts`, `production-*.integration.ts`, `haccp/*.test.ts` |
| Οικονομικά | `/finance` | `FinanceAccount`, `FinanceTransaction`, `FinanceStatement*`, `Expense`, `SupplierPayment*`, `CashClosing`, `BudgetTarget`, `Payroll*` | `finance*.test.ts`, `finance*.integration.ts` |
| Συναλλασσόμενοι/CRM | `/parties`, `/customers` | `Party` (+ διευθύνσεις, επαφές, κανάλια, IBAN, δραστηριότητες), `Person` | `parties.test.ts`, `party-*.test.ts`, `crm.test.ts` |
| Προσωπικό | `/staff`, `/schedule/[token]` | `Employee`, `EmployeePay`, `Shift`, `EmployeeLeave`, `SchedulePublication` | `staff.*` |
| Αναφορές | `/`, `/reports` | — (υπολογισμοί) | `reports.*`, `dashboard.test.ts` |
| GDPR | `/gdpr`, `/platform/gdpr` | `Consent`, `ErasureRequest`, `GdprEvent` | `gdpr/rules.test.ts` |
| Πλατφόρμα SaaS | `/platform/*`, `/billing` | `Subscription*`, `Plan`, `StorePause`, `Ticket*`, `Kb*`, `RemoteAccess` | `billing.integration.ts`, `plans.test.ts` |
| Μετάπτωση | `/migration` | `MigrationCutover`, `MigrationRun`, `MigrationRecord` | `migration-cutover.*`, `legacy-migration.*` |

## 5. Κύριες ροές όπως υπάρχουν σήμερα

1. **Πώληση στο ταμείο**: καλάθι → `POST /api/pos/sales` → πληρωμή Viva (terminal ή Android) → `result` → `FiscalDocument` (receipts:sign) → απόδειξη. Ο timeout σημαίνει «άγνωστο αποτέλεσμα», όχι νέα χρέωση. Πώληση χωρίς σύνδεση μπαίνει σε ουρά (`/api/pos/sales/offline`, `lib/pos-offline.ts:35`). **Δεν γράφεται κίνηση αποθέματος** (ανοιχτή απόφαση Ε4).
2. **Τραπέζι**: `openBill` → γύροι (`addRound`, `lib/bills.ts:103`), καθένας με δελτίο 8.6 (`issueRoundSlip`, `lib/order-slips.ts:41`) → μοίρασμα (`BillShare`) → τελικές αποδείξεις που συνδέονται με τον γύρο (`FiscalDocument.billRoundId`) → `closeBillIfDone`.
3. **Επιστροφή λιανικής**: `refundSale` (`lib/pos-refund.ts:14`) → πιστωτικό 11.4 με αναφορά στο αρχικό → επιστροφή χρημάτων Viva.
4. **Αγορά**: παραγγελία → παραλαβή (μερική, με αποκλίσεις, παρτίδες, θερμοκρασία) → τιμολόγιο (χειροκίνητο, OCR ή από myDATA) → three-way match → καταχώριση (στοκ + μέσο κόστος) → πληρωμή με κατανομή.
5. **Χονδρική**: προσφορά → παραγγελία → `SalesDocument` 1.1/2.1/9.3/5.1 μέσω Viva ή ΑΑΔΕ → είσπραξη με κατανομή.
6. **Παραγωγή**: πλάνο → παρτίδα (ανάλωση πρώτων υλών ανά παρτίδα, έξοδος σε lot) → κλείσιμο ημέρας παραγωγής.
7. **Κλείσιμο ταμείου**: `closeCashRegister` (`lib/finance-db.ts:204`) υπολογίζει αναμενόμενα μετρητά, κάρτες, πλατφόρμες· επαναφορά με αιτιολογία.
8. **Τράπεζα**: εισαγωγή αρχείου κίνησης → αντιστοίχιση με ledger και με ομαδοποιημένες εκκαθαρίσεις Viva (gross − προμήθεια, `lib/finance-reconciliation.ts:186`) → καμία αντιστοίχιση δεν γράφει νέα κίνηση.

## 6. Αλληλεπικαλύψεις

| Θέμα | Τι υπάρχει | Σχόλιο |
|-|-|-|
| Δύο ταμεία | `Sale` (λιανική) και `SalesDocument` (χονδρική) | Σωστός διαχωρισμός, αλλά οι αναφορές πρέπει να τα αθροίζουν μαζί |
| Δύο μηχανισμοί βάρδιας | `TillShift`/`TillDayClose` (ανά ταμείο) και `CashClosing` (ανά κατάστημα/ημέρα) | Να οριστεί ποιο είναι το επίσημο κλείσιμο και να συνδεθούν |
| Δύο μητρώα ειδών | `Product` (ταμείο) και `GenericItem`/`TradeItem` (αποθήκη) | Η σύνδεση γίνεται μέσω `Recipe.productId`. Λείπει η ανάλωση στην πώληση |
| Δύο πάροχοι myDATA | Viva ISV και ΑΑΔΕ απευθείας | Επιλογή ανά εκδότη· να μείνει ρητό ποιος διαβιβάζει κάθε τύπο (MYD-10) |
| Δικαιώματα προσωπικού | `StaffStoreAccess` | Δεν το διαβάζει κανένας κώδικας (`docs/audit/IMPLEMENTATION_LOG.md`) |

## 7. Τεχνικό χρέος (από το προηγούμενο audit και από αυτό)

| Κωδ. | Θέμα | Βάρος |
|-|-|-|
| H9 | Δεν υπάρχει τεκμηριωμένο αυτόματο backup και δοκιμή επαναφοράς (υπάρχουν μόνο τα πεδία `lastBackupCheckAt`/`lastRestoreDrillAt` και οθόνη `/platform/continuity`) | P0 |
| H6/3.6 | Τα μυστικά (`Setting`, `Integration.clientSecret`, `aadeSubKey`) **αποθηκεύονται χωρίς κρυπτογράφηση**· περιμένει κλειδί στο Coolify (Ε6) | P0 |
| 4.4/Ε5 | Το κλείσιμο επιχείρησης σβήνει και φορολογικά παραστατικά. Θέλει διατήρηση για το νόμιμο διάστημα | P0 |
| H10/Ε4 | Η πώληση δεν κινεί απόθεμα, οπότε το θεωρητικό κόστος και η απόκλιση απογραφής δεν βγαίνουν | P1 |
| M8/1.6 | Πωλήσεις που μένουν «σε αναμονή» δεν λήγουν αυτόματα με έλεγχο στη Viva | P0 |
| — | `FiscalStatus` έχει μόνο `NOT_SENT/PENDING/SIGNED/FAILED`: λείπουν «άγνωστο» και «ακυρώθηκε» ως ρητές καταστάσεις | P0 |
| — | Migration drift στα defaults του `FiscalAttempt`/`FiscalDocument` (σημείωση της 28/11) | P1 |
| — | Δεν υπάρχουν E2E tests σε browser και tenant isolation tests σε όλα τα routes | P0 |
| — | Δεν υπάρχουν structured logs, metrics ή alerts πέρα από `console.error` και `/api/health` | P0 |

## 8. Τι επαληθεύτηκε και πώς

| Τρόπος | Τι |
|-|-|
| Unit tests που έτρεξαν | Ποσά και στρογγυλοποιήσεις, χτίσιμο XML myDATA και Viva receipts, parsing εισερχομένων, κανόνες επανάληψης διαβιβάσεων, μοίρασμα λογαριασμού, modifiers, κυκλικές συνταγές, ανάλυση συνταγών, αντιστοίχιση τιμολογίου, κανόνες επιστροφών προμηθευτή, δικαιώματα, rate limit, GDPR, offline ουρά (mobile) |
| Integration tests που υπάρχουν (δεν ξανατρέχτηκαν) | Αποθήκη, προμήθειες (παραλαβή/τιμολόγιο/συμφωνία), χονδρική, οικονομικά, παραγωγή, αναφορές, συνδρομές, μετάπτωση, POS API, business E2E |
| Χειροκίνητη δοκιμή σε demo (από προηγούμενες συνεδρίες) | Πώληση μετρητών/κάρτας και επιστροφή σε Viva terminal, 8.6 τραπεζιών, 1.1/5.1/9.3 χονδρικής μέσω Viva |
| Μόνο στατικός έλεγχος | Όλα τα υπόλοιπα, μεταξύ τους tenant isolation, KDS, αναφορές, export λογιστή |
