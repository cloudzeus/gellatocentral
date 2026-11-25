<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Gelato System — τι είναι

Πολυ-επιχειρησιακό SaaS (multi-tenant) για καταστήματα γελάτου: συνδρομές, ταμείο (POS web/Android), ηλεκτρονική τιμολόγηση μέσω Viva, CRM συναλλασσομένων, GDPR. Κάθε πίνακας επιχειρησιακών δεδομένων έχει `orgId` — ποτέ ερώτημα χωρίς φίλτρο tenant.

## Stack (ακριβείς εκδόσεις — δες `package.json`)

- Next.js 16 App Router + Turbopack, `cacheComponents: true`, `partialPrefetching: true`, `output: "standalone"`
- React 19, TypeScript strict, Tailwind CSS 4 (μέσω `@tailwindcss/turbopack`)
- Prisma 7 με `@prisma/adapter-pg` (PostgreSQL)· ο client παράγεται στο `lib/generated/prisma`
- zod 4 για validation, `node --test` για tests — όχι jest/vitest

## Εντολές

| Σκοπός | Εντολή |
|-|-|
| Ανάπτυξη | `npm run dev` |
| Tests (όλα στο `lib/**/*.test.ts`) | `npm test` |
| Έλεγχος τύπων | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Schema βάσης | `npx prisma migrate dev` · client: `npx prisma generate` |
| Αρχικά δεδομένα (admin) | `npx prisma db seed` |

## Χάρτης κώδικα

- `app/(app)/` — οθόνες εφαρμογής (RSC)· `app/api/` — route handlers· `app/layout.tsx`, `globals.css`
- `lib/` — όλη η server λογική, ένα module ανά domain (`auth`, `parties`, `crm`, `billing`, `pos`, `viva/`, `gdpr/`…). Tests δίπλα στο αρχείο: `foo.test.ts`
- `lib/db.ts` — το μοναδικό σημείο εισόδου στη βάση: `import { db } from "@/lib/db"` (singleton μέσω `globalThis`). Ποτέ `new PrismaClient` αλλού
- `components/` — client/shared UI· `prisma/schema.prisma` — 48 models, πηγή αλήθειας για τα δεδομένα
- Alias `@/*` → ρίζα του έργου

## Κανόνες που δεν παραβιάζονται

1. **Tenant isolation**: κάθε query σε επιχειρησιακά δεδομένα φιλτράρει με `orgId` (και `storeId` όπου χρειάζεται). Δες `lib/auth.ts` (`currentOrg`) και `lib/party-scope.ts`.
2. **Χρήματα σε λεπτά** (`Int`) — ποτέ `Float`/`Decimal` για ποσά. Μορφοποίηση μόνο στο UI.
3. **Auth/RBAC**: συνεδρία σε httpOnly cookie (sha256 στη βάση). Σε routes: `getUser()` → 401, έλεγχος permission → 403. Σε σελίδες: `requireUser()` / `currentOrg("<permission>")`. Δίκτυο δικαιωμάτων στο `lib/permissions.ts`.
4. **Per-request memoization** με `cache()` του React για auth/context (`lib/auth.ts`, `lib/tenant.ts`).
5. **Βάση μέσα σε λειτουργίες**: πολλαπλές εγγραφές σε `db.$transaction([...])`.
6. **Σχόλια και commit messages στα Ελληνικά**, σε ύφος του υπάρχοντος κώδικα (σύντομα, εξηγούν το «γιατί»). Το `// shortcut:` σημαίνει συνειδητό τεχνικό χρέος — μην το «διορθώνεις» χωρίς αίτημα.
7. **Προσωπικά δεδομένα**: GDPR-first — αιτήματα προς τρίτους (χάρτες, VIES) περνούν από δικά μας API routes, όχι από τον browser.

## Λίστες, καταστάσεις και πορεία εργασίας

- **Λίστα-ευρετήριο** = `DataTable` (`components/data-table.tsx`) με `listParams` (`lib/paging.ts`), `skip`/`take` και πραγματικό `count` με το ίδιο `where`· 25 ανά σελίδα. Ποτέ δικό `<table>` με σταθερό `take` που κόβει σιωπηλά. Υπόδειγμα: `app/(app)/orders/page.tsx`.
- **Κατάσταση** = `<StatusBadge>` από τον κεντρικό χάρτη `lib/status.ts` (εικονίδιο + λέξη + χρώμα). Νέο enum → νέα γραμμή εκεί, όχι τοπικός χάρτης στη σελίδα. Καμία αγγλική τιμή enum στην οθόνη.
- **Μήνυμα μετά από ενέργεια** = toast. Με redirect: `?saved=<πρόταση>` ή `?error=<λόγος>` (το διαβάζει κεντρικά το layout, `lib/flash.ts`)· τύλιξε τη διεύθυνση με `redirectUrl()` όταν έχει ελληνικά. Χωρίς redirect: `await flashOk("…")` / `flashFail("…")` από `lib/flash-server.ts`. Το λάθος μένει ΚΑΙ δίπλα στη φόρμα.
- **`redirect()` μέσα σε `try`**: το `catch` πρέπει να το ξαναπετά (`workflowMessage` το κάνει· αλλιώς `rethrowControlFlow(error)`), αλλιώς η επιτυχία γίνεται `?error=NEXT_REDIRECT`.
- **Ό,τι κρατά πάνω από 2 δευτ.** (πολλά αντικείμενα ή εξωτερική υπηρεσία) τυλίγεται σε `runTask(...)` (`lib/tasks.ts`) και φαίνεται στο παράθυρο «Εργασίες». «Ξανά» μόνο για είδη στο `lib/task-kinds.ts`, όπου η επανάληψη δεν μπορεί να διπλοστείλει.

## Πριν παραδώσεις αλλαγή

`npm test && npx tsc --noEmit` — αν άλλαξες schema, και `npx prisma migrate dev` + ξανατρέξε τα tests.
