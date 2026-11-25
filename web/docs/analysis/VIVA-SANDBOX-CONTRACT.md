# Viva Cloud Terminal — sandbox contract readiness

## Σκοπός

Το `scripts/viva-sandbox-contract.ts` ελέγχει το πραγματικό contract του Viva Cloud Terminal ISV API και την επαναχρησιμοποίηση του server-side `verifySaleSession`. Δεν αποτελεί αυτόματο test που τρέχει σιωπηλά: απαιτεί ρητό opt-in, demo ISV credentials, demo terminal και χειροκίνητη ενέργεια στο τερματικό.

Ο runner:

- καλεί **μόνο** τα hardcoded demo hosts `demo-accounts.vivapayments.com` και `demo-api.vivapayments.com`.
- Δεν εισάγει `lib/config`, Prisma, `lib/db` ή app tenant context, δεν διαβάζει configured remote DB και δεν φορτώνει αυτόματα `.env`.
- Δεν γράφει πώληση, payment, fiscal document ή οποιοδήποτε άλλο DB record.
- Δεν έχει production URL override, production fallback ή mocked success path.
- Χρησιμοποιεί νέο UUID `sessionId` και μοναδικό `merchantReference` σε κάθε εκτέλεση, ώστε να αποφεύγονται duplicate sessions.

Πηγή των API assumptions: [επίσημο Cloud Terminal API spec](https://developer.viva.com/downloads/eft-pos-api.yml).

## Προϋποθέσεις

1. Demo ISV Client ID και Client Secret.
2. Demo terminal που είναι online και μπορεί να δεχτεί Cloud Terminal sale.
3. Το UUID του merchant που ενεργοποίησε το terminal (`terminalMerchantId`).
4. Ρητή επιβεβαίωση `VIVA_SANDBOX_CONFIRM=RUN_DEMO_SALE`.
5. Ποσό τουλάχιστον 30 λεπτά, όπως απαιτεί το sandbox spec. Το default είναι 30 και το runner επιτρέπει 30–1000 λεπτά.

Το sale εμφανίζεται στο πραγματικό demo terminal και μπορεί να απαιτήσει αποδοχή/ακύρωση από τον χειριστή. Δεν πρέπει να τρέχει σε παραγωγικό terminal ή με production credentials.

## Εκτέλεση

```bash
VIVA_SANDBOX_CONFIRM=RUN_DEMO_SALE \
VIVA_DEMO_ISV_CLIENT_ID='demo-client-id' \
VIVA_DEMO_ISV_CLIENT_SECRET='demo-client-secret' \
VIVA_DEMO_TERMINAL_ID='demo-terminal-id' \
VIVA_DEMO_TERMINAL_MERCHANT_ID='demo-terminal-merchant-uuid' \
npx tsx scripts/viva-sandbox-contract.ts
```

Προαιρετικά, bounded runtime controls:

```bash
VIVA_DEMO_AMOUNT_CENTS=30
VIVA_DEMO_HTTP_TIMEOUT_MS=10000
VIVA_DEMO_TOTAL_TIMEOUT_MS=120000
VIVA_DEMO_POLL_INTERVAL_MS=2000
```

| Μεταβλητή | Default | Επιτρεπόμενο |
|-|-:|-:|
| `VIVA_DEMO_AMOUNT_CENTS` | 30 | 30–1000 |
| `VIVA_DEMO_HTTP_TIMEOUT_MS` | 10000 | 1000–30000 |
| `VIVA_DEMO_TOTAL_TIMEOUT_MS` | 120000 | 5000–300000 |
| `VIVA_DEMO_POLL_INTERVAL_MS` | 2000 | 250–10000 |

Χωρίς confirmation ή χωρίς κάποιο υποχρεωτικό demo credential/terminal, η έξοδος είναι `NOT RUN`, δεν γίνεται network call και το exit status είναι 0. Σε πραγματική εκτέλεση, μόνο `PASS` έχει exit status 0· provider/contract failure και timeout έχουν exit status 1.

## Request assumptions που ελέγχονται

### OAuth token

- `POST https://demo-accounts.vivapayments.com/connect/token`
- HTTP Basic με τα ρητά demo ISV credentials.
- Form body `grant_type=client_credentials`.
- Απαιτείται HTTP success και μη κενό string `access_token`.

### ISV sale

- `POST https://demo-api.vivapayments.com/ecr/isv/v1/transactions:sale`
- Bearer token από το προηγούμενο βήμα.
- `sessionId`: νέο UUID.
- `terminalId`: μόνο το ρητά δοσμένο demo terminal.
- `cashRegisterId`: σταθερό `gelato-sandbox-contract`.
- `amount`: integer λεπτά, default 30.
- `currencyCode`: `978`.
- `merchantReference`: `gelato-sandbox:<sessionId>`.
- `tipAmount`: 0, `showTransactionResult`: true, `showReceipt`: false.
- `isvDetails.terminalMerchantId`: ο demo merchant του terminal.
- Δεν στέλνεται `fiscalisationData`: το script ελέγχει payment/session contract, όχι ΑΑΔΕ fiscalisation ή υπογραφές.

Το ISV envelope ακολουθεί το τρέχον `startSale`. Το δημόσιο spec σημειώνει το `isvDetails.amount` ως required, ενώ η τρέχουσα εφαρμογή στέλνει μόνο `terminalMerchantId`. Το script **δεν το κρύβει** προσθέτοντας διαφορετικό payload· ένα HTTP 400 σε αυτό το σημείο πρέπει να καταγραφεί ως readiness finding και να αξιολογηθεί ξεχωριστά, όχι να μετατραπεί σε PASS.

### Session polling

- `GET https://demo-api.vivapayments.com/ecr/isv/v1/sessions/<uuid>`.
- HTTP 202 σημαίνει pending, ακόμη και με κενό body.
- HTTP 200 απαιτεί JSON object.
- Άλλα non-success statuses διακόπτουν με controlled HTTP error, χωρίς logging response body.
- Κάθε HTTP request έχει timeout. Το polling έχει συνολικό deadline και δεν ξεκινά νέο request μετά το deadline.

## Response contract και fail-closed κανόνες

Για verified success το υπάρχον `verifySaleSession` απαιτεί:

- `success === true` με Boolean, όχι truthy string/number.
- `sessionId` ίσο με το UUID που στάλθηκε.
- `merchantReference` ίσο με το μοναδικό reference του run.
- `cashRegisterId === "gelato-sandbox-contract"`.
- `terminalId` ίσο με το demo terminal.
- `amount` ακριβώς ίσο με τα λεπτά του request.
- Μη κενό string `transactionId` από τον provider.

Σε τελικό failure, `success === false` καταγράφεται ως `PROVIDER FAILURE`, όχι ως PASS. Η απάντηση πρέπει να έχει τα ίδια session/sale/device/terminal bindings. Αν υπάρχει `amount`, πρέπει να ταυτίζεται. Δεν απαιτείται `transactionId` σε αποτυχία.

Μετά την τελική απάντηση γίνεται τοπικό replay με σκόπιμα λάθος `terminalId`. Το mismatch πρέπει να απορριφθεί. Αυτό ελέγχει τον fail-closed φράχτη χωρίς δεύτερη provider κλήση και χωρίς επιπλέον συναλλαγή.

## Έξοδοι

| Έξοδος | Σημασία |
|-|-|
| `NOT RUN` | Δεν δόθηκε πλήρες ρητό opt-in· καμία κλήση. |
| `PENDING` | Ο provider επέστρεψε 202· η αναμονή συνεχίζεται εντός deadline. |
| `PASS` | Πραγματική τελική απάντηση πέρασε όλο το `verifySaleSession` και το mismatch replay απορρίφθηκε. |
| `PROVIDER FAILURE` | Δεμένη τελική απάντηση με `success=false`· δεν είναι contract PASS. |
| `CONTRACT FAILURE` | Missing/invalid πεδίο, mismatch ή αστοχία του mismatch guard. |
| `TIMEOUT` | Μόνο pending μέχρι το συνολικό deadline· καμία τεκμαρτή επιτυχία. |
| `ERROR` | Network, HTTP, timeout ή malformed token/session response. |

## Redaction και αρχεία καταγραφής

- Δεν τυπώνονται Client Secret, Client ID, terminal merchant ID, Basic/Bearer credentials ή access token.
- Δεν τυπώνεται raw provider response, request Authorization header, PAN ή fiscalisation payload.
- Το τελικό summary περιέχει μόνο whitelist metadata: Boolean `success`, ποσό, currency, numeric event IDs, ύπαρξη transaction ID και provider message.
- Τα error texts περνούν από redaction για γνωστά secrets και Bearer/token-like πεδία.
- Δεν δημιουργούνται log/report αρχεία. Η έξοδος του terminal δεν πρέπει να αντικαθίσταται από μη αποθαυμασμένο raw response dump.

## Επαναληψιμότητα και όρια

- Νέο UUID ανά run αποτρέπει το duplicate-session replay του provider.
- Το mismatch scenario είναι deterministic τοπικό replay της ίδιας τελικής απάντησης.
- Pending, success και failure καλύπτονται επίσης με mocked unit tests, χωρίς network.
- Το script δεν αποδεικνύει fiscalisation, QR/MARK, webhook delivery ή Android callback. Αυτά χρειάζονται ξεχωριστά contract checks.
- Ένα PASS σημαίνει συμβατότητα του συγκεκριμένου demo payment/session run, όχι γενική πιστοποίηση production συμπεριφοράς.

## Πραγματικός demo έλεγχος — 24/11/2026

- Το demo OAuth authentication με τα ρητά ISV credentials επέστρεψε HTTP 200 και έγκυρο `access_token`.
- Δεν εκτελέστηκε sale και δεν δημιουργήθηκε session, επειδή δεν δόθηκε demo `terminalId`.
- Το αποτέλεσμα αποδεικνύει μόνο έγκυρο demo authentication· το συνολικό payment/session contract παραμένει **NOT RUN**, όχι PASS.
- Τα credentials χρησιμοποιήθηκαν μέσω προσωρινού τοπικού environment file με περιορισμένα δικαιώματα, το οποίο διαγράφηκε αμέσως· δεν αποθηκεύτηκαν στο έργο.
