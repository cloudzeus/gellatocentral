"use client";

import { ArrowLeft, LayoutDashboard, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AuthCard } from "./auth-card";
import { StateScreen } from "./state-screen";
import { btn, Card, Page } from "./ui";

type Props = { error: unknown; retry: () => void };
// Από το σφάλμα δείχνουμε μόνο το digest (κωδικός αντιστοίχισης με τα logs του server): ποτέ μήνυμα ή stack.
const digestOf = (error: unknown) => (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : undefined);

/** A1 · Σφάλμα μέσα στην εφαρμογή: το μενού μένει. */
export function AppError({ error, retry }: Props) {
  return (
    <Page section="Σφάλμα" title="Κάτι πήγε στραβά">
      <Card className="mx-auto max-w-lg p-6 sm:p-8">
        <StateScreen
          tone="error" icon={TriangleAlert} title="Η σελίδα δεν φόρτωσε" digest={digestOf(error)}
          actions={<>
            <button type="button" autoFocus onClick={() => retry()} className={btn()}><RotateCw /> Δοκίμασε ξανά</button>
            <Link href="/" className={btn("outline")}><LayoutDashboard /> Πίνακας ελέγχου</Link>
          </>}
          footer={<>Συνεχίζει; <Link href="/support" className="font-medium text-foreground underline underline-offset-4">Γράψε στην υποστήριξη</Link></>}
        >
          Το λάθος είναι από τη δική μας πλευρά, όχι από κάτι που έκανες. Ό,τι είχες ήδη αποθηκεύσει δεν χάθηκε.
        </StateScreen>
      </Card>
    </Page>
  );
}

/** A2 · Σφάλμα σε όλη τη σελίδα: χωρίς shell. Απλό <a>, γιατί ο router μπορεί να έχει πέσει. */
export function FullPageError({ error, retry }: Props) {
  return (
    <AuthCard>
      <StateScreen
        tone="error" icon={TriangleAlert} heading="h1" title="Η εφαρμογή δεν άνοιξε" digest={digestOf(error)}
        actions={<>
          <button type="button" autoFocus onClick={() => retry()} className={btn()}><RotateCw /> Δοκίμασε ξανά</button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={btn("outline")}>Αρχική σελίδα</a>
        </>}
      >
        Το λάθος είναι από τη δική μας πλευρά. Ό,τι είχες ήδη αποθηκεύσει δεν χάθηκε. Δοκίμασε ξανά σε λίγο.
      </StateScreen>
    </AuthCard>
  );
}

export function BackButton() {
  return <button type="button" onClick={() => history.back()} className={btn("outline")}><ArrowLeft /> Πίσω εκεί που ήμουν</button>;
}
