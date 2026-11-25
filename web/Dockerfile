# Εικόνα παραγωγής για Coolify (build context: ο φάκελος web/).
# Τρία στάδια: εξαρτήσεις → build → μικρή τελική εικόνα με το standalone output του Next.

FROM node:24-alpine AS deps
WORKDIR /app
# Το prisma generate τρέχει στο postinstall, οπότε χρειάζεται το schema πριν το npm ci.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN apk add --no-cache openssl && npm ci

FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
# Ο prisma client παράχθηκε στο postinstall του deps (gitignored, δεν υπάρχει στο clone)
COPY --from=deps /app/lib/generated ./lib/generated
COPY . .
# Το build δεν ακουμπά βάση· η μεταβλητή υπάρχει μόνο για να φορτώσει καθαρά το prisma config.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Μόνο το prisma CLI με τις εξαρτήσεις του, για το migrate deploy στο start —
# χωρίς να σέρνουμε όλο το node_modules της εφαρμογής στην τελική εικόνα.
FROM node:24-alpine AS migrate-deps
WORKDIR /migrate
# Ακριβείς εκδόσεις, ίδιες με το package-lock.json: αλλιώς ένα deploy μπορεί να τρέξει migrations με νεότερο CLI
# από αυτό που δοκιμάστηκε. Όταν αναβαθμίζεται το prisma στο package.json, αλλάζει και εδώ.
RUN apk add --no-cache openssl && npm install --omit=dev prisma@7.10.1 dotenv@18.0.10

FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Standalone output + στατικά + public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# Migrations στο start: schema, config και το prisma CLI (συγχωνεύεται με τα
# traced node_modules του standalone — δεν έχουν κοινά πακέτα).
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/prisma.config.ts ./
COPY --from=migrate-deps --chown=app:app /migrate/node_modules ./node_modules
COPY --chown=app:app docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER app
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
