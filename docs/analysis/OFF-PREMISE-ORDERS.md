# Παραγγελίες εκτός καταστήματος και αναγνώριση πελάτη

Mockup: `docs/mockups/central-till/orders-callerid.html` (+ `.png`). Κατάσταση: **εγκρίθηκε 2026-11-26, υλοποιήθηκε** (βλ. «Τι φτιάχτηκε» στο τέλος).

## Τι υπάρχει ήδη

- `Reservation` έχει όνομα και τηλέφωνο (κανονικοποιημένο), όχι σύνδεση με πελάτη. Το `guestHistory` (`web/lib/reservations.ts`) βρίσκει επισκέψεις και «δεν ήρθε» από το τηλέφωνο. Η κράτηση δένει με `Bill`, άρα τα είδη που πήρε βγαίνουν από τα `BillLine` των λογαριασμών του: **το βήμα 3 δεν χρειάζεται αλλαγή σχήματος**.
- `Party` / `PartyAddress` / `PartyChannel` (τηλέφωνα, ευρετήριο στο `value`) / `PartyActivity` (`source=telephony`, `externalId` μοναδικό ανά πηγή: έτοιμο για καταγραφή κλήσεων).
- `PartyMap` (Leaflet/OSM) στο web· `AddressField` με προτάσεις.
- Παλιό mockup «Παραγγελίες: τηλέφωνο, Wolt, efood» (`central-till-tables-orders.html` §3)· το νέο το συμπληρώνει.

## Yeastar (επίσημη τεκμηρίωση help.yeastar.com)

- **P-Series** (Cloud/Software/Appliance), OpenAPI v1.0. Στο PBX: Integrations › API → ενεργοποίηση, Client ID / Client Secret, προαιρετικά λίστα IP. «Call Status Monitor» στις γραμμές (trunks).
- Token: `POST /openapi/v1.0/get_token` `{username: ClientID, password: Secret}` → `access_token` 30′, `refresh_token` 24 ώ· έως 8 ενεργά tokens ανά εφαρμογή. Κάθε κλήση με `?access_token=` και υποχρεωτικό `User-Agent`.
- Γεγονότα: **Webhook** (Cloud από firmware 84.20.0.21, έως 5 URL, υπογραφή `X-Signature` = Base64(HMAC-SHA256(raw body, secret))) ή **WebSocket** (`/openapi/v1.0/subscribe`, `{"topic_list":[30011,30012]}`, heartbeat < 60″).
- **30011 Call State Changed**: `msg.call_id`, `members[]` με `inbound{from,to,trunk_name,member_status}` και `extension{number,member_status}`· `member_status` ALERT/RING/ANSWERED/BYE. Αναγνώριση: inbound ALERT ή extension RING → καλών = `inbound.from`, ποιο εσωτερικό = ποιο ταμείο. Dedupe ανά `call_id` (έρχεται σε κάθε αλλαγή). **30012** = εγγραφή κλήσης στο τέλος (καταγραφή, αναπάντητες).
- Click-to-call: `POST /openapi/v1.0/call/dial` `{caller, callee}` (κουμπί «Κλήση» στο mockup).
- S-Series: API v2.0 (`CallStatus`, `NewCdr`), τέλος υποστήριξης 1/7/2027 → μόνο αν το έχει ήδη πελάτης.
- **Ανεπιβεβαίωτο:** ποιο πακέτο P-Series χρειάζεται για το OpenAPI· το σώμα του webhook σε πραγματική κλήση (υποθέτουμε `{type, sn, msg}` όπως στο WebSocket). Θέλει δοκιμή σε πραγματικό PBX.
- Πηγές: help.yeastar.com/en/p-series-cloud-edition/developer-guide/{enable-yeastar-p-series-pbx-api, get-access-token, monitor-events-via-webhook, event-call-status-changed, make-a-call}.html, …/p-series-appliance-edition/developer-guide/monitor-events-via-websocket.html, yeastar.com/eol-policy/

## Wolt (developer.wolt.com)

- Webhook `order.notification` (υπογραφή `WOLT-SIGNATURE` HMAC-SHA256 hex με το client secret) → `GET /v2/orders/{id}`. Ενέργειες `PUT /orders/{id}/accept` (δηλώνει χρόνο ετοιμασίας), `reject`, `ready`, `pickup-completed`, `delivered`. Μενού: POST ολόκληρο + ενημέρωση διαθεσιμότητας. Κατάστημα online/offline: `PATCH /venues/{id}/online`. Πληρωμή: `cash_payment` όταν είναι μετρητά.
- Ένταξη: φόρμα αίτησης, η Wolt επιλέγει· μετά sandbox, demo, πιλοτικό κατάστημα. Υποχρεωτικά Order + Venue + Menu API.

## efood (Delivery Hero POS Integration Middleware)

- Το efood (Ελλάδα) υποστηρίζεται από το middleware της Delivery Hero (developers.deliveryhero.com/documentation/pos.html). Παραγγελίες έρχονται με push σε δικό μας endpoint («plugin»). Αποδοχή με χρόνο και δικό μας αριθμό, απόρριψη με λόγο, «preparation-completed», ακύρωση από αυτούς προς εμάς. Μενού: Catalog Import API. Δύο ροές: αποδοχή στο tablet της DH (σε εμάς έρχονται μόνο αποδεκτές) ή αποδοχή στο POS (εγκρίνεται κατά περίπτωση).
- Ένταξη: αίτηση με PGP κλειδί (+NDA), ο τοπικός εκπρόσωπος δίνει στοιχεία, δοκιμή σε test vendor.
- **Ανεπιβεβαίωτο:** πεδία πληρωμής του payload (online / μετρητά) — η προδιαγραφή θέλει πρόσβαση συνεργάτη.

## Ανοιχτά (για τον χρήστη / λογιστή)

1. **Ποιος εκδίδει απόδειξη myDATA στις online πληρωμένες Wolt/efood;** Καμία πλατφόρμα δεν το λέει στα docs. Το mockup υποθέτει: εκδίδουμε εμείς στην αποδοχή με τρόπο πληρωμής «μέσω πλατφόρμας». Θέλει επιβεβαίωση από λογιστή και account manager.
2. Χωρίς έγκριση συνεργάτη από Wolt/efood δεν υπάρχουν κλειδιά. Προτείνεται: κοινό μοντέλο παραγγελίας + προσαρμογείς ανά πλατφόρμα, με «δοκιμαστική παραγγελία» από την κονσόλα μέχρι να έρθουν τα κλειδιά.
3. Μοντέλο Yeastar του πελάτη (P-Series; πακέτο;) και αν το webhook φτάνει στον server (δημόσιο HTTPS).

## Σχέδιο υλοποίησης (μετά την έγκριση)

1. **Σχήμα** (ένα migration): `Order` (orgId, storeId, source PHONE|WOLT|EFOOD, externalId μοναδικό ανά source, partyId?, addressId?, fulfilment DELIVERY|PICKUP, status NEW→ACCEPTED→READY→OUT→DELIVERED / REJECTED / CANCELLED, readyAt, payment DOOR_CASH|DOOR_CARD|PLATFORM|TILL, totalCents, note, raw Json, saleId?) + `OrderLine` (όπως `BillLine`, productId προαιρετικό για άγνωστα είδη) + `Call` (orgId, callId μοναδικό, from, extension, deviceId?, partyId?, state, startedAt, answeredAt, endedAt, orderId?). Ρυθμίσεις σύνδεσης (Yeastar, Wolt, efood) στο υπάρχον `Setting`/σελίδα ρυθμίσεων, μυστικά κρυπτογραφημένα· αντιστοίχιση εσωτερικού → συσκευή.
2. **Server** (`web/lib/orders.ts`, `web/lib/telephony/yeastar.ts`): εύρεση πελάτη από τηλέφωνο (`PartyChannel`/`Party.phone`, κανονικοποίηση +30), καρτέλα (διευθύνσεις, τελευταίες παραγγελίες όλων των καναλιών, ανά μήνα), «Ξανά» με τρέχουσες τιμές, μεταβάσεις κατάστασης, έκδοση απόδειξης από την παραγγελία (ίδια ροή με `Sale`). Webhook Yeastar με έλεγχο υπογραφής πριν το parse, dedupe `call_id`· `PartyActivity` κλήσης.
3. **Wolt/efood**: προσαρμογείς (webhook + υπογραφή, accept/reject/ready) πίσω από κοινή διεπαφή· «δοκιμαστική παραγγελία» από την κονσόλα.
4. **Ταμείο** (`mobile/`): μενού «Παραγγελίες» (λίστα + λεπτομέρεια), αποδοχή με χρόνο, τηλεφωνική πάνω στην οθόνη πώλησης, καρτέλα κλήσης. Ειδοποίηση κλήσης στο ταμείο με polling ανά 2″ του `/api/pos/calls` (shortcut· SSE αργότερα).
5. **Κρατήσεις**: `guestHistory` επιστρέφει και τα είδη που παίρνει (από 3 επισκέψεις και πάνω), τελευταίες επισκέψεις, τραπέζι που προτιμά.
6. **Κονσόλα**: Ρυθμίσεις › Συνδέσεις, γράφημα κλήσεων ημέρας.
7. **Tests**: κανονικοποίηση τηλεφώνου, ανάλυση 30011, υπογραφές webhook, μεταβάσεις κατάστασης, «τι παίρνει συνήθως», «Ξανά».

## Τι φτιάχτηκε (2026-11-26)

- Σχήμα: `Order`, `OrderLine`, `Call`, `Integration`, `Device.pbxExtension` (migration `20261126190000_off_premise_orders`).
- Server: `lib/order.ts` (κανόνες, tests), `lib/orders.ts` (καρτέλα πελάτη, τηλεφωνική παραγγελία → λογαριασμός, μεταβάσεις), `lib/telephony/yeastar.ts` (υπογραφή, 30011/30012, tests), `lib/telephony/calls.ts`.
- API: `/api/webhooks/yeastar/[id]` (υπογραφή πριν το parse), `/api/pos/calls`, `/api/pos/customers`, `/api/pos/orders`, `/api/pos/orders/[id]`.
- Πληρωμή στην πόρτα / στο ταμείο: η παραγγελία ανοίγει λογαριασμό και πληρώνεται με τη ροή των λογαριασμών (απόδειξη, βάρδια). Πληρωμένη online: χωρίς λογαριασμό και **χωρίς απόδειξη** μέχρι να απαντηθεί το ανοιχτό 1.
- Ταμείο: μενού «Παραγγελίες» (`mobile/OrdersScreen.tsx`), καρτέλα κλήσης σε κάθε οθόνη (polling 2″), «Ξανά», αποστολή τηλεφωνικής από την οθόνη πώλησης, «τι παίρνει συνήθως» στη νέα κράτηση.
- Κονσόλα: Ρυθμίσεις › Συνδέσεις (`/company/connections`): Yeastar, εσωτερικό ανά ταμείο, γράφημα κλήσεων, δοκιμαστική κλήση και δοκιμαστική παραγγελία Wolt/efood.
- Δεν έγιναν: προσαρμογείς Wolt/efood (θέλουν κλειδιά συνεργάτη), χάρτης στην καρτέλα του ταμείου, γεωκωδικοποίηση νέας διεύθυνσης, κρυπτογράφηση του Client Secret.
