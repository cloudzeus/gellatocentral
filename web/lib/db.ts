import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Ρητά όρια στο pool: χωρίς connectionTimeoutMillis ένα αίτημα περιμένει ελεύθερη σύνδεση επ' αόριστον όταν η βάση
// κολλήσει. DATABASE_POOL_MAX μόνο αν χρειαστεί (προεπιλογή του pg: 10 ανά διεργασία).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX) || undefined,
      connectionTimeoutMillis: 10_000,
    }),
  });

// Και στην παραγωγή: αν ο server φορτώσει το module σε δεύτερο bundle, δεν ανοίγει δεύτερο pool.
globalForPrisma.prisma = db;
