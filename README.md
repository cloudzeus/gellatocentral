# Gelato System SaaS

| Φάκελος | Τι είναι |
|---|---|
| `web/` | Η εφαρμογή (Next.js 16.4.5, Prisma, PostgreSQL) |
| `mobile/` | Το ταμείο για Android (React Native / Expo) |
| `docs/analysis/` | Ανάλυση και οπτικό σύστημα |

## Εκκίνηση (web)

```bash
cd web
cp .env.example .env        # όρισε DATABASE_URL
npm install
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Έλεγχοι: `npm test`, `npm run lint`, `npm run build`.

## Εκκίνηση (Android)

```bash
cd mobile
npm install
npx expo run:android
```

Σύζευξη συσκευής Android: στην κονσόλα (Συνδρομητές › επιχείρηση › Ταμεία) πάτα «Κωδικός σύζευξης» και γράψε τον στην εφαρμογή.

## Deploy στο Coolify (web)

Το repo μένει ως έχει — το Coolify χτίζει μόνο τον φάκελο `web/` μέσω του `web/Dockerfile`. Στο Coolify:

1. **New Resource → Application** από αυτό το git repo.
2. **Build Pack: Dockerfile**, **Base Directory: `/web`** (Dockerfile location: `/Dockerfile`).
3. Μεταβλητές περιβάλλοντος (Environment):
   - `DATABASE_URL` — σύνδεση PostgreSQL (βλ. «Απομακρυσμένη βάση» παρακάτω)
   - `DIRECT_URL` — προαιρετικά, απευθείας Postgres για migrations αν η εφαρμογή πάει μέσω PgBouncer
   - `TRUST_PROXY=1` — η εφαρμογή τρέχει πίσω από τον proxy του Coolify
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — μόνο για τον πρώτο seed (`npx prisma db seed`)
4. Port: `3000`. Healthcheck: `GET /api/health`.

Σε κάθε deploy το container τρέχει αυτόματα `prisma migrate deploy` πριν σηκώσει τον server (`web/docker-entrypoint.sh`). Το `mobile/` και το `docs/` δεν μπαίνουν στην εικόνα — το build context είναι μόνο το `web/`.

### Απομακρυσμένη βάση (όχι στο Coolify)

Η βάση δεν στήνεται στο Coolify — το `DATABASE_URL` δείχνει στον υπάρχοντα server:

```
DATABASE_URL="postgresql://<user>:<password>@<db-host>:5432/gelato?schema=public"
```

Προϋποθέσεις στον db server:

- **pgvector**: η βάση χρειάζεται την επέκταση `vector` (τη ζητά migration). Στον db server: πακέτο `postgresql-16-pgvector` (Debian/Ubuntu) και μετά `CREATE EXTENSION IF NOT EXISTS vector;` μέσα στη βάση — ή τρέξε τη βάση με εικόνα `pgvector/pgvector:pg16`. Αν λείπει, το container δεν σηκώνεται (το migrate deploy αποτυγχάνει).
- **Πρόσβαση**: ο db server δέχεται συνδέσεις από την IP του Coolify host (firewall + `pg_hba.conf` + `listen_addresses`). Αν η σύνδεση περνά από το ανοιχτό internet, υποχρεωτικά TLS (`?sslmode=require` στο `DATABASE_URL`).
- Ο χρήστης της βάσης θέλει δικαίωμα DDL (CREATE/ALTER TABLE, CREATE EXTENSION) — το `migrate deploy` εφαρμόζει migrations σε κάθε deploy.
