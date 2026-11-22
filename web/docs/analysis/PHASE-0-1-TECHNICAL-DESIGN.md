# Φάσεις 0 και 1 — τεχνικό σχέδιο SaaS θεμελίων και αποθέματος

Ημερομηνία σχεδίου: 2026-11-22
Κάλυψη: `SAAS-01` έως `SAAS-06` και `STK-01` έως `STK-09` του `SAAS-MIGRATION-BACKLOG.md`
Σκοπός του εγγράφου: επαρκώς συγκεκριμένη αφετηρία υλοποίησης, χωρίς να θεωρείται ότι έχει ήδη γραφτεί κώδικας ή εφαρμοστεί migration.

## 1. Στόχος, παραδοτέα και μη στόχοι

### 1.1 Στόχος

1. Κάθε νέα ενότητα να έχει συμφωνημένα RBAC, package/module access και URL access.
2. Κάθε επιχειρησιακή εγγραφή και ενέργεια να περνά από tenant-aware server context, με πρόσθετους ελέγχους store/warehouse όπου χρειάζονται.
3. Το απόθεμα να παραμένει append-only ιστορικό `StockMovement`, με σωστό υπόλοιπο ανά είδος, αποθήκη και παρτίδα.
4. Οι μεταφορές και οι οριστικοποιήσεις απογραφών να είναι ατομικές, επαναλήψιμες με ασφάλεια και ανθεκτικές σε ταυτόχρονες εγγραφές.
5. Οι απογραφές να έχουν αμετάβλητο snapshot, μετρημένη ποσότητα, διαφορά και συνδεδεμένη κίνηση διόρθωσης.

### 1.2 Παραδοτέα των δύο φάσεων

- Κατάλογος permissions και αντίστοιχισή τους με modules, system roles και routes.
- Κοινό authorization/audit πρότυπο για server actions και route handlers.
- Server-side αποθέματα, λήξεις/FEFO και οθόνη αποθέματος Α΄ υλών.
- Άμεσες, οριστικές μεταφορές μεταξύ αποθηκών.
- Draft/finalized απογραφές Α΄ υλών σε εργαστήριο και κατάστημα.
- Αιτιολογημένες διορθώσεις και αντίστροφες εγγραφές, όχι διαγραφή ιστορικού.
- Offline ουρά μόνο για draft δεδομένα απογραφής, ως `P1` μετά τη σταθερή online ροή.
- Εντός εφαρμογής ειδοποιήσεις χαμηλού αποθέματος και λήξεων, ως `P1`.

### 1.3 Μη στόχοι

- Δεν δημιουργείται παράλληλος πίνακας «τρέχοντος αποθέματος» χωρίς μετρημένη ανάγκη απόδοσης.
- Δεν γίνεται μεταφορά παλιών δεδομένων ή cutover· αυτά ανήκουν στη Φάση 8.
- Δεν υλοποιούνται παραγγελίες προμηθευτών, MRP, χονδρική, παραστατικά, πλήρες HACCP ή οικονομικά.
- Το POS `Product` δεν θεωρείται αυτομάτως stock item.
- Η Φάση 1 δεν παραδίδει απόθεμα παραγόμενων/ημιέτοιμων. Αυτό απαιτεί `PRD-02`· η απογραφή ετοίμων ενεργοποιείται μόνο μετά από αυτό.
- Δεν επιτρέπεται offline οριστικοποίηση ή offline φορολογική εγγραφή.

## 2. Υπάρχουσα αφετηρία και προβλήματα που κλείνει το σχέδιο

### 2.1 Ήδη χρήσιμα

- `lib/auth.ts`: `currentOrg(needs)` ενώνει ρόλο και ομάδες, αφαιρεί permissions κλειστών modules και επιστρέφει `storeIds`.
- `MembershipStore`: κενή λίστα σημαίνει πρόσβαση σε όλα τα καταστήματα.
- `lib/plan-data.ts`: το package, η παύση και η κατάσταση συνδρομής περιορίζουν τα ανοιχτά modules.
- `Warehouse` και `StoreWarehouse`: το απόθεμα ανήκει στην αποθήκη· η σχέση με καταστήματα είναι πολλαπλή.
- `StockMovement` και `StockLot`: append-only κινήσεις και παρτίδες με batch/λήξη.
- `PurchaseDoc`, `ProductionBatch` και οι χειροκίνητες διορθώσεις δείχνουν τις υπάρχουσες ροές εγγραφής.

### 2.2 Μεταβολές που απαιτούνται πριν από τις νέες ροές

1. Η `stockLevel(tx, warehouseId)` αθροίζει όλο το ιστορικό της αποθήκης. Δεν μπορεί να χρησιμοποιηθεί για απόφαση αρνητικού υπολοίπου είδους ή παρτίδας.
2. Αγορές, παραγωγή και χειροκίνητη διόρθωση γράφουν κινήσεις από διαφορετικά σημεία. Πρέπει να συγκλίνουν σε έναν writer με κοινούς ελέγχους.
3. Δεν υπάρχει warehouse membership. Το store scope μόνο του δεν αρκεί για εργαστήριο ή κεντρική αποθήκη.
4. Δεν υπάρχουν typed συνδέσεις κίνησης με transfer/count.
5. Το `occurredAt` είναι επιχειρησιακή ημερομηνία και μπορεί να είναι παλιότερη. Για να ανιχνεύεται εγγραφή μετά από snapshot χρειάζεται χωριστό `recordedAt`.
6. Το `StockLot` είναι warehouse-scoped. Σε μεταφορά δεν μπορεί να χρησιμοποιηθεί το ίδιο `lotId` και στις δύο αποθήκες· χρειάζεται αντιστοίχη παρτίδα προορισμού με κοινή επιχειρησιακή ταυτότητα.

## 3. Αμετάβλητα συμβόλαια

### 3.1 Tenant, μονάδες και ιστορικό

- Κάθε query επιχειρησιακών δεδομένων περιέχει `orgId`, ακόμη και όταν το ID είναι CUID.
- Κάθε εγγραφή με store context φιλτράρεται και με `storeId`/store membership.
- Κάθε warehouse operation ελέγχει ότι warehouse, store, είδη και παρτίδες ανήκουν στο ίδιο `orgId`.
- Οι ποσότητες αποθέματος είναι θετικοί ή αρνητικοί ακέραιοι στη βασική μονάδα του `GenericItem`: mg, ml ή τεμάχια. Η μετατροπή g → mg γίνεται μόνο στην είσοδο/παρουσίαση.
- Χρήματα σε λεπτά `Int`. Κόστος ανά βασική μονάδα σε εκατοστά λεπτού `Int` (`*CostHundredths`).
- Δεν γίνεται update/delete σε posted `StockMovement`. Διόρθωση σημαίνει νέα, αντίθετη ή συμπληρωματική κίνηση.
- Finalized transfer/count δεν επεξεργάζεται και δεν διαγράφεται. Το audit χρησιμοποιεί σταθερό user ID όπου υπάρχει και snapshot ονόματος.

### 3.2 Μοναδική πηγή αποθέματος

Το stock key είναι:

```text
(orgId, warehouseId, genericItemId, lotId)
```

- `lotId = null` είναι διακριτό υπόλοιπο από παρτίδα με `batchNumber = null`. Δεν γίνεται σιωπηρή συγχώνευσή τους.
- Οι νέες stock λειτουργίες απαιτούν `genericItemId`. Παλιές κινήσεις πώλησης με `genericItemId = null` δεν αποδίδονται υποθετικά σε είδος.
- Το τρέχον υπόλοιπο είναι `SUM(quantity)` για το πλήρες stock key.
- Για λίστες χρησιμοποιείται `groupBy`/SQL aggregation στη βάση, όχι μεταφορά κινήσεων στον browser.
- «Διαθέσιμο» ισούται με on-hand στη Φάση 1. Δεν εμφανίζεται δεσμευμένο = 0 αν δεν υπάρχει ακόμη μοντέλο δέσμευσης· η στήλη μένει κρυφή ή δηλώνεται «μη διαθέσιμο».
- Η μεταφορά δεν αλλάζει το `GenericItem.avgCostHundredths`. Η απογραφή δεν ξαναϋπολογίζει μέσο κόστος· αποτιμά μόνο τη διαφορά με snapshot κόστους.

### 3.3 Μεταφορά

Για κάθε γραμμή:

- Η ποσότητα είναι θετικός ακέραιος στη βασική μονάδα.
- Η αποθήκη πηγής διαφέρει από την αποθήκη προορισμού.
- Γράφονται ακριβώς δύο κινήσεις: `-quantity` στην πηγή και `+quantity` στον προορισμό.
- Οι κινήσεις έχουν ίδιο `orgId`, `genericItemId`, `transferId`, `transferLineId` και απόλυτη ποσότητα, αλλά διαφορετικό `warehouseId`.
- Αν υπάρχει παρτίδα, η εξερχόμενη δείχνει στη source lot και η εισερχόμενη στη destination lot.
- Destination lot βρίσκεται ή δημιουργείται με ίδια `orgId`, `genericItemId`, `batchNumber`, `expiresAt` και το `warehouseId` προορισμού.
- Αν υπάρχει destination lot με ίδιο generic/batch αλλά διαφορετική λήξη, η μεταφορά απορρίπτεται· δεν αλλάζεται σιωπηρά η λήξη και δεν δημιουργείται διπλότυπο που παραβιάζει το existing unique.
- Το `documentId` της destination lot δεν αντικαθίσταται· η προέλευση παραμένει ανιχνεύσιμη μέσω source lot και transfer.
- Το κόστος αποτυπώνεται μία φορά στη transfer line και χρησιμοποιείται για την αποτίμηση και των δύο πλευρών. Δεν δημιουργείται έσοδο/έξοδο κόστους.

### 3.4 Απογραφή

- Draft: επεξεργάσιμες μόνο πραγματικές ποσότητες/αιτιολογίες. Warehouse, store, ημερομηνία και expected snapshot δεν αλλάζουν· για αλλαγή δημιουργείται νέο draft.
- Το `expectedQty` παγώνει στο `snapshotAt`. Το `actualQty` και το `differenceQty` αποθηκεύονται, ώστε το finalized ιστορικό να μην εξαρτάται από μεταγενέστερο recalculation.
- `differenceQty = actualQty - expectedQty`. Για κάθε μη μηδενική διαφορά απαιτείται αιτιολογία.
- Στην οριστικοποίηση γράφεται το πολύ μία correction κίνηση ανά count line, μόνο όταν η διαφορά είναι μη μηδενική.
- Αν υπάρχει οποιαδήποτε κίνηση της αποθήκης με `recordedAt > snapshotAt`, η οριστικοποίηση αποτυγχάνει με `STOCK_CHANGED_SINCE_SNAPSHOT`. Δεν γίνεται αυτόματο rebase. Ο χρήστης δημιουργεί νέο draft ή ξανακάνει snapshot με ρητή ενέργεια και νέα μέτρηση.
- Επιτρέπονται πολλά drafts, αλλά το πολύ μία finalized απογραφή ανά `orgId + warehouseId + countedOn`. Η δεύτερη παίρνει `FINALIZED_COUNT_EXISTS`.
- Finalized απογραφή δεν ξανανοίγει. Λάθος μετά την οριστικοποίηση διορθώνεται με νέα αιτιολογημένη stock correction και σύνδεσμο αναφοράς, όχι με rewrite.
- Store count: υποχρεωτικά `storeId` και `warehouseId`, με έγκυρο `StoreWarehouse`.
- Workshop/warehouse count: `storeId = null`, με ρητό warehouse access.
- Στη Φάση 1 μετριούνται μόνο `GenericItem` με `trackStock = true`. Τα finished goods περιμένουν `PRD-02`.

## 4. Phase 0 — RBAC, modules και πρόσβαση

### 4.1 Νέες και συμπληρωμένες areas

| Area | Actions | Χρήση |
|-|-|-|
| `warehouses` | `read`, `add`, `edit` | Υπάρχουσα διαχείριση αποθηκών |
| `stock` | `read`, `transfer`, `correct` | Υπόλοιπα, μεταφορές, μεταγενέστερες διορθώσεις |
| `counts` | `read`, `add`, `edit`, `finalize` | Drafts, καταχώριση μέτρησης και οριστικοποίηση |
| `orders` | `read`, `add`, `edit` | Μελλοντικές παραγγελίες προμηθευτών |
| `wholesale` | `read`, `add`, `edit` | Μελλοντική χονδρική/B2B |
| `invoices` | `read`, `add`, `edit`, `cancel` | Μελλοντικά εκδιδόμενα παραστατικά |
| `staff` | `read`, `add`, `edit`, `delete` | Μελλοντικό προσωπικό και βάρδιες |
| `finance` | `read`, `edit` | Μελλοντικά οικονομικά |
| `haccp` | `read`, `add`, `edit` | Μελλοντικοί έλεγχοι HACCP |
| `reports` | `read` | Μελλοντικές αναφορές |
| `vitrine` | `read`, `edit` | Μελλοντική βιτρίνα |

Το `ACTION_LABEL` επεκτείνεται για `transfer`, `finalize`, `correct`, `cancel`. Το `normalize` συνεχίζει να δίνει αυτόματα `read` όταν υπάρχει άλλη ενέργεια της ίδιας area.

### 4.2 Module mapping

| Module | Permissions που πρέπει να περιλαμβάνει | Paths |
|-|-|-|
| `production` | `production.*`, `haccp.*` | `/production`, `/traceability`, `/haccp` |
| `inventory` | `warehouses.*`, `purchases.*`, `stock.*`, `counts.*`, `orders.*` | `/inventory`, `/purchases`, `/counts`, `/orders` |
| `wholesale` | `wholesale.*`, `invoices.*`, `vitrine.*` | `/wholesale-orders`, `/invoices`, `/vitrine` |
| `team` | `staff.*`, `reports.*` | `/staff`, `/reports` |
| `finance` | `finance.*` | `/finance` |

Τα `recipes`, `products` και `items` permissions πρέπει να συμπεριλαμβάνονται πλήρως στο module `recipes`, όχι μόνο τα `items.*`.

Προτεινόμενο route mapping:

| Route | Permission |
|-|-|
| `/inventory` και `/inventory/warehouses` | `warehouses.read` |
| `/inventory/stock` | `stock.read` |
| `/inventory/transfers` | `stock.read` |
| `/counts` | `counts.read` |
| `/orders` | `orders.read` |
| `/haccp` | `haccp.read` |
| `/staff` | `staff.read` |
| `/reports` | `reports.read` |
| `/finance` | `finance.read` |
| `/wholesale-orders` | `wholesale.read` |
| `/invoices` | `invoices.read` |
| `/vitrine` | `vitrine.read` |

Τα μελλοντικά permissions μπαίνουν στον κατάλογο από τη Φάση 0, αλλά δεν αποκτούν ψεύτικες σελίδες ή μενού πριν υλοποιηθεί το αντίστοιχο domain.

### 4.3 System roles

- «Επιχειρηματίας»: όλα, αυτόματα και για μελλοντικές προσθήκες.
- «Manager»: όλα τα operational permissions των modules που ήδη διαχειρίζεται, συμπεριλαμβανομένων `stock.*` και `counts.*`.
- «Υπάλληλος»: καμία νέα πρόσβαση από default migration. Η πρόσβαση δίνεται ρητά από ρόλο/ομάδα.
- Δεν απαιτείται backfill κλειδωμένων ρόλων· το `orgPermissionsOf` ήδη δίνει `ALL_PERMISSIONS`.
- Τα tests πρέπει να ελέγχουν και το `canGrant`, ώστε χρήστης να μην παραχωρεί permission που δεν έχει.

### 4.4 Warehouse membership

Προστίθεται `MembershipWarehouse`. Καμία αρχική γραμμή δεν σημαίνει «όλες οι αποθήκες εντός του επιτρεπόμενου store scope», όχι απεριόριστα όλες ανεξάρτητα από store restrictions.

Effective scope:

1. Αν το `storeIds` είναι μη κενό, ο χρήστης βλέπει μόνο warehouses συνδεδεμένες με αυτά τα stores, εκτός αν του έχει δοθεί ρητά πρόσθετη warehouse membership.
2. Αν το `storeIds` είναι κενό, έχει store scope σε όλα τα stores του tenant.
3. Αν το `warehouseIds` είναι μη κενό, επιτρέπονται μόνο τα δηλωμένα warehouses, και μόνο όταν ανήκουν στο tenant.
4. Αν το `warehouseIds` είναι κενό και ο χρήστης έχει πρόσβαση σε όλα τα stores, επιτρέπονται όλα τα warehouses του tenant.
5. Σε λειτουργία με `storeId` απαιτούνται ταυτόχρονα store membership, warehouse membership και έγκυρο `StoreWarehouse`.
6. Standalone εργαστηριακή αποθήκη χωρίς store link δεν γίνεται ορατή σε store-restricted χρήστη μόνο επειδή το warehouse membership είναι κενό· χρειάζεται ρητή membership.

Δεν γίνεται backfill με γραμμές «όλα»· η κενή λίστα διατηρεί τη συμβατότητα και αποφεύγει αχρείαστα δεδομένα.

### 4.5 Authorization matrix

| Ενέργεια | Permission | Store/warehouse έλεγχοι |
|-|-|-|
| Προβολή αποθέματος | `stock.read` | Effective warehouse scope· αν ζητηθεί store, και store scope |
| Δημιουργία/εκτέλεση μεταφοράς | `stock.transfer` | Και οι δύο warehouses επιτρεπτές και ενεργές· έγκυρο store context αν δοθεί |
| Δημιουργία draft | `counts.add` | Warehouse access· store + `StoreWarehouse` για store count |
| Επεξεργασία draft | `counts.edit` | Ίδιο scope, status `DRAFT` |
| Οριστικοποίηση | `counts.finalize` | Ίδιο scope, ενεργή αποθήκη/store, status `DRAFT` |
| Χειροκίνητη διόρθωση | `stock.correct` | Warehouse access, υποχρεωτική αιτιολογία |
| Διαχείριση warehouse memberships | `users.edit` | Δεν επιτρέπεται ανάθεση warehouse εκτός tenant ή δικαιωμάτων actor |
| Ανάγνωση finalized ιστορικού | `stock.read` ή `counts.read` | Φίλτρο tenant και effective scope |

Η ενεργή συνδρομή/module ελέγχεται μέσω `currentOrg(permission)`. Για εγγραφή ελέγχονται επιπλέον `Store.active` και `Warehouse.active`. Το μενού δεν θεωρείται security boundary.

### 4.6 Κοινό server context

Προτεινόμενο API:

```ts
type StockContext = {
  orgId: string;
  userId: string;
  userName: string;
  permissions: readonly Permission[];
  storeIds: readonly string[];      // [] = όλα τα stores
  warehouseIds: readonly string[]; // [] = όλα εντός store scope
};

requireStockContext(permission, {
  storeId?: string,
  warehouseId?: string,
  warehouseIds?: string[],
  forWrite?: boolean,
}): Promise<StockContext>;
```

- Σελίδα: `requireUser()`/`currentOrg("…​.read")` και scoped queries.
- Server action: πάντα `currentOrg(permission)` και επανέλεγχος entity scope· δεν αρκούν hidden form IDs.
- Route handler: `getUser()` → 401, permission → 403, scoped entity που δεν βρέθηκε → 404 χωρίς αποκάλυψη ξένου tenant.
- Οι έλεγχοι ownership επαναλαμβάνονται μέσα στη posting transaction, ώστε η απόφαση και η εγγραφή να μην βασίζονται σε ασύνδετα δεδομένα.

## 5. Προτεινόμενο Prisma schema

Τα blocks είναι σχεδιαστικό contract. Στην υλοποίηση προστίθενται και οι αντίστροφες relations σε `Organization`, `Membership`, `Warehouse`, `GenericItem`, `StockLot` και `User`, χωρίς μετονομασία υπαρχόντων πεδίων.

### 5.1 Enums

```prisma
enum StockCountStatus {
  DRAFT
  FINALIZED
}
```

Το transfer δεν χρειάζεται status στο αρχικό scope: η επιτυχής ύπαρξη `StockTransfer` σημαίνει posted. Μισογραμμένο transfer απαγορεύεται από transaction. Αν αργότερα ζητηθεί draft transfer, προστίθεται ρητή state machine και δεν αναμειγνύεται με την άμεση ροή.

### 5.2 Warehouse access και audit

```prisma
model MembershipWarehouse {
  orgId        String
  membershipId String
  warehouseId  String
  createdAt    DateTime   @default(now())
  org          Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  membership   Membership   @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  warehouse    Warehouse    @relation(fields: [warehouseId], references: [id], onDelete: Cascade)

  @@id([membershipId, warehouseId])
  @@index([orgId, warehouseId])
  @@index([warehouseId])
}

model AuditEvent {
  id          String       @id @default(cuid())
  orgId       String
  actorId     String?
  actorName   String
  action      String
  entityType  String
  entityId    String
  storeId     String?
  warehouseId String?
  reason      String?
  metadata    Json?
  createdAt   DateTime     @default(now())
  org         Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  actor       User?        @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([orgId, entityType, entityId, createdAt])
  @@index([orgId, createdAt])
  @@index([orgId, warehouseId, createdAt])
}
```

Το `metadata` περιέχει μόνο μη ευαίσθητα structured δεδομένα, π.χ. `fromStatus`, `toStatus`, `lineCount`. Δεν χρησιμοποιείται ως πρόσχαρη αποθήκη ολόκληρου form ή προσωπικών δεδομένων.

### 5.3 Μεταφορές

```prisma
model StockTransfer {
  id                   String             @id @default(cuid())
  orgId                String
  sourceWarehouseId    String
  destinationWarehouseId String
  storeId              String? // πλαίσιο UI· η κίνηση παραμένει warehouse-scoped
  clientKey            String
  requestHash          String
  note                 String?
  createdById          String?
  createdByName        String
  createdAt            DateTime           @default(now())
  org                  Organization       @relation(fields: [orgId], references: [id], onDelete: Cascade)
  sourceWarehouse      Warehouse          @relation("TransferSource", fields: [sourceWarehouseId], references: [id], onDelete: Restrict)
  destinationWarehouse Warehouse          @relation("TransferDestination", fields: [destinationWarehouseId], references: [id], onDelete: Restrict)
  store                Store?             @relation(fields: [storeId], references: [id], onDelete: Restrict)
  createdBy            User?              @relation(fields: [createdById], references: [id], onDelete: SetNull)
  lines                StockTransferLine[]
  movements            StockMovement[]

  @@unique([orgId, clientKey])
  @@index([orgId, sourceWarehouseId, createdAt])
  @@index([orgId, destinationWarehouseId, createdAt])
  @@index([orgId, storeId, createdAt])
}

model StockTransferLine {
  id                  String        @id @default(cuid())
  orgId               String
  transferId          String
  genericItemId       String
  sourceLotId         String?
  destinationLotId    String?
  quantity            Int // πάντα > 0, βασική μονάδα
  unitCostHundredths  Int // snapshot αποτίμησης, όχι νέα αγορά
  transfer            StockTransfer @relation(fields: [transferId], references: [id], onDelete: Restrict)
  genericItem         GenericItem   @relation(fields: [genericItemId], references: [id], onDelete: Restrict)
  sourceLot           StockLot?     @relation("TransferSourceLot", fields: [sourceLotId], references: [id], onDelete: Restrict)
  destinationLot      StockLot?     @relation("TransferDestinationLot", fields: [destinationLotId], references: [id], onDelete: Restrict)
  movements           StockMovement[]

  @@unique([orgId, transferId, genericItemId, sourceLotId])
  @@index([orgId, genericItemId])
}
```

DB checks στο migration:

- `sourceWarehouseId <> destinationWarehouseId`.
- `quantity > 0` και `unitCostHundredths >= 0`.
- `sourceLotId` και `destinationLotId` είτε και τα δύο null είτε και τα δύο μη null.
- Partial unique για `sourceLotId IS NULL` στο `(orgId, transferId, genericItemId)`, επειδή το κανονικό unique επιτρέπει πολλαπλά null στην PostgreSQL.

### 5.4 Απογραφές

```prisma
model StockCount {
  id               String           @id @default(cuid())
  orgId            String
  storeId          String?
  warehouseId      String
  countedOn        DateTime         @db.Date
  snapshotAt       DateTime
  status           StockCountStatus @default(DRAFT)
  clientKey        String
  requestHash      String
  note             String?
  createdById      String?
  createdByName    String
  finalizedById    String?
  finalizedByName  String?
  finalizedAt      DateTime?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  org              Organization     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  store            Store?           @relation(fields: [storeId], references: [id], onDelete: Restrict)
  warehouse        Warehouse        @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  createdBy        User?            @relation("CountCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  finalizedBy      User?            @relation("CountFinalizedBy", fields: [finalizedById], references: [id], onDelete: SetNull)
  lines            StockCountLine[]
  movements        StockMovement[]

  @@unique([orgId, clientKey])
  @@index([orgId, warehouseId, countedOn, status])
  @@index([orgId, storeId, countedOn])
}

model StockCountLine {
  id                  String       @id @default(cuid())
  orgId               String
  countId             String
  genericItemId       String
  lotId               String?
  expectedQty         Int
  actualQty           Int?
  differenceQty       Int?
  unitCostHundredths  Int
  reason              String?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt
  count               StockCount   @relation(fields: [countId], references: [id], onDelete: Restrict)
  genericItem         GenericItem  @relation(fields: [genericItemId], references: [id], onDelete: Restrict)
  lot                 StockLot?    @relation(fields: [lotId], references: [id], onDelete: Restrict)
  movement            StockMovement?

  @@unique([orgId, countId, genericItemId, lotId])
  @@index([orgId, genericItemId])
}
```

Συμπληρωματικά DB constraints:

- Partial unique finalized count:

```sql
CREATE UNIQUE INDEX "StockCount_finalized_day_key"
ON "StockCount" ("orgId", "warehouseId", "countedOn")
WHERE "status" = 'FINALIZED';
```

- Partial unique no-lot line στο `(orgId, countId, genericItemId) WHERE lotId IS NULL`.
- `actualQty >= 0`, `unitCostHundredths >= 0`.
- `actualQty` και `differenceQty` είτε και τα δύο null είτε συνεπή με `differenceQty = actualQty - expectedQty`.
- Σε finalized count όλες οι γραμμές έχουν `actualQty`. Η οριστικοποίηση απορρίπτεται αν λείπει μέτρηση ή αν η μη μηδενική διαφορά δεν έχει αιτιολογία.

### 5.5 Επέκταση StockMovement

```prisma
model StockMovement {
  id             String    @id @default(cuid())
  orgId          String
  storeId        String?
  warehouseId    String
  documentId     String?
  lineId         String?
  transferId     String?
  transferLineId String?
  countId        String?
  countLineId    String?   @unique
  quantity       Int
  genericItemId  String?
  lotId          String?
  source         String    @default("sale")
  note           String?
  createdById    String?
  createdByName  String?
  occurredAt     DateTime  @default(now())
  recordedAt     DateTime  @default(now())
  // υπάρχουσες relations + νέες relations προς transfer/count/user

  @@index([orgId, warehouseId, genericItemId, lotId])
  @@index([orgId, warehouseId, recordedAt])
  @@index([orgId, transferId])
  @@index([orgId, countId])
  @@unique([orgId, transferLineId, warehouseId])
}
```

- Το `source` παραμένει `String` για μη destructive migration. Νέες σταθερές: `transfer`, `count`. Οι υπάρχουσες `sale`, `purchase`, `production`, `manual` δεν αλλάζουν.
- `documentId`/`lineId` παραμένουν για sale/purchase. Transfer/count χρησιμοποιούν τα νέα typed πεδία, όχι overloading των παλιών.
- `countLineId @unique` εμποδίζει δεύτερη correction για την ίδια γραμμή. Στην PostgreSQL επιτρέπονται πολλαπλά null.
- Το transfer pair unique εμποδίζει δεύτερη κίνηση της ίδιας line στην ίδια αποθήκη.
- `createdById` προστίθεται χωρίς να αφαιρεθεί το `createdByName`.

## 6. Stock access και concurrency

### 6.1 Ένας stock writer

Προτεινόμενο contract:

```ts
postStockMovement(tx, {
  orgId,
  warehouseId,
  genericItemId, // υποχρεωτικό για stock-aware εγγραφή
  lotId,
  quantity,      // μη μηδενικός ακέραιος
  source,
  storeId?,
  transferId?, transferLineId?, countId?, countLineId?,
  note?, occurredAt?, actor: { id, name },
}): Promise<StockMovement>;
```

Ο writer:

1. Ελέγχει ότι warehouse/generic/lot ανήκουν στο `orgId` και ότι lot συμφωνεί με warehouse + generic.
2. Ελέγχει θετικό/αρνητικό ακέραιο, μη μηδενική ποσότητα και βασική μονάδα.
3. Παίρνει τα καθορισμένα locks πριν διαβάσει υπόλοιπο.
4. Για αρνητική ποσότητα υπολογίζει το υπόλοιπο του πλήρους stock key και απορρίπτει αποτέλεσμα κάτω από μηδέν.
5. Γράφει `recordedAt` από τη βάση και πλήρη actor/typed references.
6. Δεν εμπιστεύεται client-supplied balance ή destination lot.

Παλιά πώληση χωρίς `genericItemId` συνεχίζει προσωρινά ως legacy sale recording, χωρίς απόδοση σε stock key και χωρίς τον λανθασμένο warehouse-wide negative check. Η πλήρης POS κατανάλωση συνταγής δεν ανήκει στη Φάση 1.

### 6.2 Locking στρατηγική

Για PostgreSQL, με όλες τις stock εγγραφές μέσα από τον ίδιο writer:

1. Κάθε writer παίρνει shared transaction advisory lock της αποθήκης και μετά exclusive transaction advisory lock του stock key.
2. Transfer παίρνει τα warehouse locks με ταξινομημένα IDs και μετά όλα τα stock-key locks με κανονικοποιημένη λεξικογραφική σειρά.
3. Finalize count παίρνει exclusive warehouse lock. Έτσι αποκλείει κάθε νέα stock εγγραφή, ακόμη και για είδος που δεν υπήρχε στο αρχικό snapshot, όσο ελέγχει το snapshot και γράφει corrections.
4. Ως key μπορεί να χρησιμοποιηθεί `hashtextextended` πάνω σε namespace + πλήρες ID tuple. Τυχόν hash collision προκαλεί μόνο επιπλέον serialization, όχι λάθος authorization ή balance.
5. Οι posting transactions τρέχουν με `Serializable` isolation ως επιπλέον προστασία. Σε `40001`/`40P01` γίνεται bounded retry ολόκληρου transaction, όχι μόνο του τελευταίου insert.
6. Κάθε νέος και παλιός writer — αγορά, παραγωγή, χειροκίνητη διόρθωση, sale που γράφει stock, transfer, count — πρέπει να ακολουθεί το ίδιο lock protocol. Αλλιώς το negative-stock guarantee δεν είναι πλήρες.

Τα fake unit tests ελέγχουν τη λογική, αλλά το πραγματικό guarantee αποδεικνύεται μόνο με integration tests σε PostgreSQL.

### 6.3 Idempotency

- `clientKey`: client-generated UUID ανά λογική ενέργεια. Για transfer/create count είναι υποχρεωτικό και unique ανά tenant.
- `requestHash`: SHA-256 canonical request, με σταθερή σειρά γραμμών και normalized ποσότητες/IDs. Δεν περιλαμβάνει actor ή τοπική ώρα.
- Ίδιο `(orgId, clientKey)` και ίδιο hash: επιστροφή του ήδη δημιουργημένου αποτελέσματος.
- Ίδιο key με διαφορετικό hash: `IDEMPOTENCY_KEY_REUSED`, χωρίς εγγραφή.
- Unique conflict κατά concurrent create: re-read και ίδια σύγκριση hash, όχι δεύτερη επιχειρησιακή εγγραφή.
- Finalize count δέχεται μόνο count ID. Αν είναι ήδη finalized, επιστρέφει το αποτέλεσμα μόνο όταν το αποθηκευμένο περιεχόμενο συμφωνεί με το request· διαφορετικό request παίρνει conflict.
- Το UI απενεργοποιεί διπλό submit, αλλά η ασφάλεια βασίζεται στα DB constraints και όχι στο κουμπί.

## 7. Λεπτομερείς ροές

### 7.1 STK-01: ανάγνωση υπολοίπων

Καθαρές συναρτήσεις:

- `correctionBaseQty`/μετατροπές εισόδου.
- `difference(actual, expected)`.
- `valueHundredths(quantity, unitCostHundredths)` με safe-integer έλεγχο.
- FEFO ordering: πρώτα νωρίτερη `expiresAt`, μετά null λήξη, μετά σταθερό lot ID.
- Expiry status από business date `Europe/Athens`, όχι από timezone του browser.

DB functions:

- `stockBalance(stockKey)`.
- `stockBalances({ orgId, warehouseIds, storeId?, genericItemIds? })`.
- `lotBalances(...)` με join σε lot/generic/unit και aggregation στη βάση.
- `assertNoMovementAfterSnapshot(...)` βάσει `recordedAt`.

### 7.2 STK-04: post transfer

1. Validate payload, permissions, idempotency και store/warehouse scope.
2. Σε transaction επαναλαμβάνονται ownership/active checks.
3. Δημιουργείται το transfer header με actor snapshot.
4. Για κάθε γραμμή επαληθεύονται generic/lot, quantity και source balance.
5. Βρίσκεται ή δημιουργείται destination lot όπως ορίζει το contract.
6. Δημιουργείται transfer line με cost snapshot.
7. Γράφονται οι δύο κινήσεις από τον κοινό writer.
8. Γράφεται `AuditEvent(action = "stock.transfer.posted")`.
9. Commit ή πλήρες rollback. Επιστρέφεται transfer ID και τα balances προς εμφάνιση.

Αποτυχία σε οποιαδήποτε γραμμή ακυρώνει header, lots που δημιουργήθηκαν, lines και movements.

### 7.3 STK-05/STK-06: δημιουργία draft

1. Validate scope και `countedOn` ως local business date.
2. Σε repeatable-read/serializable transaction διαβάζονται DB `snapshotAt` και όλα τα relevant balances από το ίδιο database snapshot.
3. Δημιουργούνται header και lines με frozen `expectedQty`, `actualQty = null` και cost snapshot.
4. Περιλαμβάνονται lots/eίδη με on-hand διάφορο του μηδενός. Ο χρήστης μπορεί να προσθέσει γραμμή για είδος με expected μηδέν.
5. Φυσικά ευρεθείσα παρτίδα που δεν υπάρχει στο σύστημα απαιτεί ρητή δημιουργία lot με batch/λήξη πριν μπει στη γραμμή· δεν εφευρίσκεται batch από το UI.

### 7.4 Επεξεργασία draft και finalize

- Update μόνο με `where: { id, orgId, status: DRAFT }` και scoped query. Δεν αλλάζουν expected/snapshot/header scope.
- Στο finalize απαιτούνται actual για κάθε line και reason για κάθε μη μηδενή διαφορά.
- Με exclusive warehouse lock ελέγχονται status, finalized-day unique, movements μετά το snapshot και τρέχοντα balances.
- Για κάθε μη μηδενή διαφορά γράφεται movement με `source = "count"`, `countId`, `countLineId`, actor, reason και `occurredAt = finalizedAt`.
- Negative correction δεν μπορεί να οδηγήσει σε αρνητικό stock key. Αν τα δεδομένα είναι ήδη ασυνεπή, η ροή σταματά για ανάλυση αντί να κρύψει το πρόβλημα.
- Header γίνεται finalized με actor/timestamp και γράφεται audit στο ίδιο transaction.
- Το conflict δεν αφήνει μερικές corrections.

### 7.5 STK-07: διορθώσεις

- Η υπάρχουσα `correctLotStock` και η αρχική αποθήκη από `items/actions.ts` μεταφέρονται στον κοινό writer.
- Permission `stock.correct`, υποχρεωτικός λόγος 3–200 χαρακτήρων και actor snapshot.
- Για finalized count δεν υπάρχει delete/edit. Νέα correction μπορεί να κρατά `note`/structured metadata με αναφορά στο αρχικό count.
- Παραγωγή και αγορά μεταφέρονται επίσης στον writer. Στην αγορά διατηρείται ο υπάρχων υπολογισμός μέσου κόστους, με κοινό locking ώστε να μην χάνονται concurrent ενημερώσεις.

### 7.6 STK-08: offline drafts

- IndexedDB ανά tenant/user/device, με client UUID, canonical payload και local revision.
- Στην ουρά μπαίνουν create draft και draft line edits. Το finalize απαιτεί online σύνδεση και νέα επιβεβαίωση.
- Ίδιο key + ίδιο payload = επιτυχής replay. Ίδιο key + διαφορετικό payload = αποκλεισμός και χειροκίνητη επιλογή.
- Αν server draft έχει finalized ή αλλάξει από άλλη συσκευή, δεν γίνεται silent overwrite· η τοπική ουρά μπαίνει σε conflict.
- Σε `STOCK_CHANGED_SINCE_SNAPSHOT` ή `FINALIZED_COUNT_EXISTS` δεν επαναλαμβάνεται τυφλά η ίδια ενέργεια.
- Τοπικά δεδομένα δεν περιέχουν credentials ή session tokens και καθαρίζονται κατά την αποσύνδεση.

### 7.7 STK-09: ειδοποιήσεις

- Χαμηλό απόθεμα μόνο όταν υπάρχει tenant-configured threshold ανά generic/warehouse· αλλιώς δεν εφευρίσκεται default threshold.
- Expiry buckets: ληγμένη, 0–3, 4–7, 8–30 ημέρες, με παραμετρικές ρυθμίσεις αργότερα αν ζητηθούν.
- Το πρώτο παραδοτέο είναι in-app view/badge από scoped queries, όχι email/cron.
- Μηδενικό υπόλοιπο δεν εμφανίζεται ως ανοιχτή παρτίδα by default, αλλά παραμένει στο ιστορικό.

## 8. Αρχεία και διαχωρισμός ευθυνών

```text
lib/permissions.ts                 # νέα areas/actions, system roles
lib/modules.ts                     # package/permission/path συμφωνία
lib/auth.ts                        # membership warehouses στο session context
lib/stock-context.ts               # effective store/warehouse authorization
lib/stock.ts                       # pure calculations, FEFO, validation helpers
lib/stock-db.ts                    # balances, locks, κοινός writer
lib/stock-transfers.ts             # transfer orchestration/idempotency
lib/stock-counts.ts                # draft/snapshot/finalize orchestration
lib/audit.ts                       # κοινό AuditEvent API
lib/warehouses.ts                  # επαναχρησιμοποίηση store↔warehouse ελέγχων
lib/purchases-db.ts                # μετάβαση στον κοινό writer
lib/production-db.ts               # μετάβαση στον κοινό writer
app/(app)/traceability/actions.ts  # correction μέσω writer
app/(app)/items/actions.ts         # initial stock μέσω writer
app/(app)/inventory/stock/         # on-hand/FEFO UI
app/(app)/inventory/transfers/     # transfer UI/actions
app/(app)/counts/                  # drafts, lines, finalize UI/actions
prisma/schema.prisma
prisma/migrations/<new>/migration.sql
```

Pure functions δεν καλούν `db`, `cookies`, `currentOrg` ή Next APIs. DB orchestration δέχεται ήδη validated command και επιστρέφει domain result/error. Server actions κάνουν FormData/Zod parsing, authorization, κλήση orchestration και `revalidatePath`.

## 9. Migration strategy

### 9.1 Σειρά

1. **M0 — code-only RBAC:** νέα permissions, actions, module/path mappings και tests. Δεν εκτίθενται νέα operational links πριν υπάρξουν οθόνες.
2. **M1 — access/audit:** `MembershipWarehouse`, `AuditEvent`, relations και indexes. Καμία διαγραφή/μετονομασία παλιού πεδίου.
3. **M2 — stock history metadata:** `StockMovement.recordedAt`, `createdById`, typed transfer/count columns και indexes. Backfill `recordedAt = CURRENT_TIMESTAMP` στις υπάρχουσες γραμμές· το επιχειρησιακό `occurredAt` μένει άθικτο. `createdById = null` όπου δεν υπάρχει αξιόπιστη αντιστοίχιση.
4. **M3 — transfer/count:** νέα tables, enums, foreign keys, unique/partial indexes και checks.
5. **M4 — writer adoption:** application release που οδηγεί όλες τις stock εγγραφές στον κοινό writer πριν ενεργοποιηθούν transfer/finalize UI.

### 9.2 Κανόνες ασφαλούς εφαρμογής

- Καμία αλλαγή στις παλιές quantities, sources, lots, occurredAt ή document references.
- Καμία εικασία `createdById` από όνομα.
- Καμία backfill εγγραφή σε `MembershipWarehouse`· η κενή λίστα έχει τεκμηριωμένη σημασία.
- Πριν από τα νέα unique indexes εκτελούνται diagnostics για τυχόν υπάρχουσες ασυνέπειες. Δεν ενοποιούνται αυτόματα παρτίδες με διαφορετική λήξη.
- Τα migrations ελέγχονται πρώτα σε αντίγραφο δεδομένων, με up migration, Prisma generate και smoke queries.
- Οι παλιές κινήσεις με `genericItemId = null` καταγράφονται ως γνωστό legacy κενό· δεν γίνεται speculative backfill.
- Rollback σημαίνει απενεργοποίηση νέων ροών και επαναφορά application version. Δεν διαγράφονται posted transfers/counts/movements για «rollback».

## 10. Implementation tasks

### 10.1 Φάση 0

| ID | Υλοποίηση και αρχεία | Εξαρτήσεις | Tests και κριτήριο done |
|-|-|-|-|
| `SAAS-01` | Νέες areas/actions, route map, system roles σε `lib/permissions.ts`. | — | Κάθε key μοναδικό, normalize/canGrant σωστά, Υπάλληλος χωρίς νέα defaults, owner παίρνει όλα. |
| `SAAS-02` | Πλήρες mapping σε `lib/modules.ts`, tests για path/module/permission. | `SAAS-01` | Κλειστό module κλείνει page και action permission· κανένα operational permission χωρίς module· τα existing paths δεν αλλάζουν κυρίαρχα. |
| `SAAS-03` | `MembershipWarehouse`, effective scope, `lib/stock-context.ts`, session include. | `SAAS-01` | Δύο tenants, restricted store/warehouse, standalone workshop, inactive entities· κάθε query/action scoped. |
| `SAAS-04` | `AuditEvent`, `lib/audit.ts`, actor/reason API. | `SAAS-03` | Status transition + audit στο ίδιο transaction· αποτυχία δεν αφήνει orphan audit· δεν υπάρχει update/delete API. |
| `SAAS-05` | Μόνο κοινό interface αρίθμησης/PDF/file/email/history και απογραφή υπαρχόντων components· όχι νέα παραστατικά. | `SAAS-03` | Contract tests για tenant-scoped file/link και σαφής αναβολή υλοποίησης στις αντίστοιχες φάσεις. |
| `SAAS-06` | Data dictionary αποφάσεων: GenericItem ≠ POS Product, βασικές μονάδες, warehouse ownership, legacy πεδία προς απόρριψη. | — | Υπογεγραμμένα mappings χωρίς ανοιχτές αντικρουόμενες αποφάσεις για Φάση 1· input στη Φάση 8. |

### 10.2 Φάση 1

| ID | Υλοποίηση και αρχεία | Εξαρτήσεις | Tests και κριτήριο done |
|-|-|-|-|
| `STK-01` | `stock-db` balances, `recordedAt`, indexes, κοινός writer και adoption στους existing writers. | `SAAS-03` | Σωστό key-level balance, no-lot διαχωρισμός, αρνητικό αποκλείεται, real PostgreSQL concurrency test, καμία παλιά κίνηση δεν αλλάζει. |
| `STK-02` | Scoped stock page, search/filter warehouse, on-hand και αποτίμηση. | `STK-01` | Pagination/aggregation server-side, tenant/store/warehouse filtering, κόστος σε σωστή μονάδα, reserved δεν παρουσιάζεται ψευδώς. |
| `STK-03` | FEFO/lot view, expiry states, traceability links. | `STK-01` | Νωρίτερη λήξη πρώτη, null τελευταία, zero handling, Athens date boundaries, ξένη lot → not found. |
| `STK-04` | Transfer schema, orchestration, UI/actions, audit. | `STK-01`, `SAAS-04` | Δύο αντίθετες κινήσεις, source/destination lots, κόστος ίδιο, rollback, double submit, concurrent transfers χωρίς αρνητικό. |
| `STK-05` | Count schema, workshop drafts, snapshot, edits, finalize, corrections. | `STK-01` | Frozen expected, persisted difference, μία correction/line, reason required, finalized immutable, changed-stock conflict, rollback. |
| `STK-06` | Store count με store + warehouse scope και same-day conflict. | `STK-05` | StoreWarehouse/membership checks, finalized-day unique, replay/conflict. Το finished-goods κομμάτι παραμένει blocked σε `PRD-02` και το task δεν δηλώνεται πλήρες γι’ αυτό. |
| `STK-07` | Κοινός correction flow, `stock.correct`, audit και αντίστροφες κινήσεις. | `STK-05` | Καμία διαγραφή/επεξεργασία history, actor/reason υποχρεωτικά, negative guard, references διατηρούνται. |
| `STK-08` | IndexedDB draft queue και sync UI. | `STK-06` | Same-key replay, payload mismatch, finalized conflict, logout cleanup, finalize μόνο online. |
| `STK-09` | In-app low-stock/expiry notifications. | `STK-02`, `STK-03` | Scoped thresholds, μηδενικό/αρνητικό handling, expiry buckets, καμία cross-tenant ειδοποίηση. |

## 11. Test matrix

### 11.1 Pure/unit tests με `node --test`

- g/ml/τεμάχια conversions, ακέραιοι και μηδενικές/αρνητικές είσοδοι.
- Stock key distinction: ίδιο generic σε δύο warehouses, δύο lots, `lotId = null`.
- Difference και αποτίμηση, συμπεριλαμβανομένου zero και safe-integer limits.
- FEFO ordering και expiry boundary 23:59/00:00 στην `Europe/Athens`.
- Permission normalize, package filtering, route permission και role defaults.
- Canonical request hashing: αναδιάταξη γραμμών όπου ορίζεται, διαφορετικό payload, διαφορετικό tenant.
- Draft validation: missing actual, reason για μη μηδενή διαφορά, immutable header fields.

### 11.2 Tenant/RBAC integration

| Σενάριο | Αναμενόμενο |
|-|-|
| Tenant A ζητά IDs του Tenant B | 404/not found, καμία εγγραφή/αποκάλυψη |
| Store-restricted χρήστης σε άλλο store | 403/not found, καμία κίνηση |
| Warehouse-restricted χρήστης σε source ή destination | Απόρριψη ολόκληρου transfer |
| Store count χωρίς `StoreWarehouse` | Απόρριψη |
| Standalone workshop χωρίς ρητή warehouse membership | Απόρριψη για store-restricted χρήστη |
| `counts.edit` αλλά όχι `counts.finalize` | Draft αλλάζει, finalize απορρίπτεται |
| Package χωρίς `inventory` | Page και actions κλειστά, όχι μόνο μενού |
| Inactive warehouse/store σε write | Απόρριψη· read ιστορικού επιτρέπεται με scope |

### 11.3 PostgreSQL stock integration

1. **Concurrent withdrawals:** αρχικό 10, δύο ταυτόχρονες εξόδους 7· μία επιτυγχάνει, μία `NEGATIVE_STOCK_NOT_ALLOWED`, τελικό 3.
2. **Concurrent transfers:** δύο transfers από την ίδια source lot· δεν υπάρχει αρνητικό, κάθε επιτυχία έχει ακριβώς δύο συνδεδεμένες κινήσεις.
3. **Transfer rollback:** σφάλμα στη δεύτερη line· δεν μένουν header, lines, destination lots ή movements από την προσπάθεια.
4. **Lot conservation:** source και destination batches/expires ίδια, quantities αντισταθμίζονται, org-wide total αμετάβλητο.
5. **Expiry mismatch:** υπάρχουσα destination lot με ίδιο batch αλλά άλλη λήξη απορρίπτεται.
6. **Finalize race:** δύο finalize στο ίδιο count· μία πραγματική οριστικοποίηση, μία idempotent επιστροφή/conflict, ποτέ δύο corrections.
7. **Movement after snapshot:** αγορά/παραγωγή/μεταφορά/διόρθωση μετά το snapshot → finalize conflict χωρίς μερικές κινήσεις.
8. **Backdated movement:** κίνηση με παλιό `occurredAt` αλλά νεότερο `recordedAt` εξακολουθεί να προκαλεί conflict.
9. **Finalized-day race:** δύο drafts ίδιας ημέρας/warehouse οριστικοποιούνται ταυτόχρονα· μόνο ένα finalized.
10. **Retry/timeout:** client δεν λαμβάνει απάντηση και ξαναστέλνει ίδιο key/payload· επιστρέφεται το ίδιο αποτέλεσμα.
11. **Key reuse:** ίδιο key με διαφορετικό payload → conflict.
12. **Existing writer adoption:** purchase, production, manual correction και stock-aware sale ακολουθούν το ίδιο protocol· race tests καλύπτουν και αυτά.
13. **Tenant constraints:** crafted relation IDs άλλου tenant απορρίπτονται πριν από οποιαδήποτε εγγραφή.

### 11.4 Offline/UI integration

- Διπλό click, refresh μετά από επιτυχία και retry μετά από network timeout.
- Δύο συσκευές επεξεργάζονται το ίδιο draft· ο server απορρίπτει stale/conflicting replay.
- Local queue δεν επιτρέπει τελική απογραφή χωρίς online response.
- Μετά από logout δεν μένουν προσβάσιμα queued δεδομένα στον επόμενο χρήστη της συσκευής.

## 12. Acceptance criteria ανά φάση

### 12.1 Φάση 0

- Δεν υπάρχει operational permission που να διαφεύγει από module/package mapping.
- Κάθε νέα page/action/route έχει ρητό permission και scoped entity checks.
- Store/warehouse scope εφαρμόζεται σε list, detail και mutation.
- Ο locked owner λαμβάνει νέα permissions χωρίς δεδομένα backfill· ο βασικός Υπάλληλος δεν αποκτά νέα πρόσβαση σιωπηρά.
- Audit και actor metadata έχουν κοινό contract.
- `npm test && npx tsc --noEmit` περνούν μετά την αντίστοιχη υλοποίηση.

### 12.2 Φάση 1

- Τα on-hand/lot/FEFO νούμερα προέρχονται από server aggregation των `StockMovement`.
- Κάθε επιτυχής transfer διατηρεί συνολική ποσότητα, batch/λήξη και κόστος, με πλήρες audit.
- Κάθε finalized count αναπαράγει ακριβώς expected/actual/difference όπως οριστικοποιήθηκε.
- Καμία concurrency ή retry ακολουθία δεν παράγει αρνητικό υπόλοιπο, orphan records ή διπλές corrections.
- Όλοι οι υπάρχοντες και νέοι stock writers χρησιμοποιούν το κοινό contract.
- Finalized ιστορικό δεν επεξεργάζεται/διαγράφεται· οι διορθώσεις είναι νέες αιτιολογημένες κινήσεις.
- Store counts Α΄ υλών λειτουργούν end-to-end. Finished goods δηλώνονται ρητά εκτός μέχρι `PRD-02`.
- Για schema αλλαγές έχουν εκτελεστεί `npx prisma migrate dev`, `npx prisma generate` και ξανά tests/typecheck.
- Το offline και οι ειδοποιήσεις μπορούν να παραδοθούν ως `P1` χωρίς να μπλοκάρουν το online MVP, αλλά δεν δηλώνονται ολοκληρωμένα χωρίς τα δικά τους tests.

## 13. Σειρά εκτέλεσης και release gates

1. `SAAS-01` και `SAAS-02` ως ένα μικρό, code-only changeset.
2. `SAAS-03` και `SAAS-04` με πρώτα migration/access tests.
3. `STK-01` και migration όλων των writers. **Gate:** δεν προχωράει transfer/finalize αν κάποιος writer παρακάμπτει το lock/balance contract.
4. `STK-02` και `STK-03` ως read-only πρώτο χρήσιμο παραδοτέο.
5. `STK-04` με real PostgreSQL concurrency tests πριν από UI activation.
6. `STK-05`, μετά `STK-06` για Α΄ υλές.
7. `STK-07` ως τελικό audit/immutability πέρασμα.
8. Online MVP acceptance, μετά `STK-08` και `STK-09`.

Δεν υπάρχει ανοιχτή σχεδιαστική απόφαση που μπλοκάρει την έναρξη: warehouse membership, one-finalized-per-day, snapshot conflict, no-lot handling και idempotency ορίζονται παραπάνω. Το μόνο εξωτερικό dependency για πλήρη απογραφή ετοίμων είναι το `PRD-02`.
