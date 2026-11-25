// Δημιουργία demo χρήστη-μέλους της Gelateria Demo για τοπική ανάπτυξη: npx tsx scripts/create-demo-user.ts
// Ο υπερδιαχειριστής πλατφόρμας δεν ανήκει σε επιχείρηση — χωρίς μέλος δεν ανοίγουν οι οθόνες tenant.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { hashPassword } from "../lib/password";

// Δημιουργεί λογαριασμό με γνωστό κωδικό: μόνο σε τοπική βάση ανάπτυξης, ποτέ σε παραγωγή.
{
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/x").hostname;
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`Άρνηση: το script τρέχει μόνο σε τοπική βάση (host: ${host}).`);
    process.exit(1);
  }
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const EMAIL = "demo@gelato.local";
const PASSWORD = "demo-gelato-123";

async function main() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("Δεν υπάρχει επιχείρηση — τρέξε πρώτα npx prisma db seed");
  const role = await db.orgRole.findFirst({ where: { orgId: org.id, locked: true } });
  if (!role) throw new Error("Δεν βρέθηκε ο ρόλος «Επιχειρηματίας» της επιχείρησης");

  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash: hashPassword(PASSWORD), failedLogins: 0, lockedUntil: null, disabledAt: null },
    create: { email: EMAIL, name: "Demo Χρήστης", passwordHash: hashPassword(PASSWORD) },
  });
  await db.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: { roleId: role.id },
    create: { orgId: org.id, userId: user.id, roleId: role.id },
  });
  console.log(`Έτοιμο: ${EMAIL} / ${PASSWORD} — μέλος «Επιχειρηματίας» της «${org.name}»`);
}

main().finally(() => db.$disconnect());
