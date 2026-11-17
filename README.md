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
