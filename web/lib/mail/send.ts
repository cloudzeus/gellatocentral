// Αποστολή μέσω Mailgun. Κλειδιά στο .env: MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_REGION (eu | us).
// Ένα επαληθευμένο domain για όλη την πλατφόρμα· κάθε πελάτης στέλνει ως <slug>@domain με δικό του όνομα και Reply-To.
import { db } from "../db";
import type { Mail } from "./templates";

export const mailConfigured = () => Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN);
export const mailDomain = () => process.env.MAILGUN_DOMAIN ?? null;
const host = () => (process.env.MAILGUN_REGION === "us" ? "api.mailgun.net" : "api.eu.mailgun.net");

/** Όνομα σε κεφαλίδα From: χωρίς εισαγωγικά και αλλαγές γραμμής (αλλιώς μπορεί να «σπάσει» η κεφαλίδα). */
const headerName = (v: string) => v.replace(/["\r\n<>]/g, "").trim();

export async function platformSettings() {
  return (await db.platformSettings.findUnique({ where: { id: 1 } })) ?? { id: 1, brandName: "Gelato System", baseDomain: null, supportEmail: null, lastBackupCheckAt: null, lastRestoreDrillAt: null, bunnyZone: null, bunnyRegion: null, bunnyCdnUrl: null, legalVersion: null, termsUrl: null, privacyUrl: null };
}

/** Διεύθυνση της εφαρμογής για έναν πελάτη: ο υποτομέας του αν υπάρχει, αλλιώς η γενική (APP_URL). */
export async function appUrl(org?: { slug: string | null } | null) {
  const { baseDomain } = await platformSettings();
  return org?.slug && baseDomain ? `https://${org.slug}.${baseDomain}` : (process.env.APP_URL ?? "http://localhost:3210");
}

type Sender = { id: string; name: string; slug: string | null; contactEmail: string | null; emailFromName: string | null };

/**
 * Στέλνει και καταγράφει. Δεν πετάει ποτέ σφάλμα: ένα email που απέτυχε δεν πρέπει να ακυρώσει την ενέργεια
 * που το προκάλεσε (π.χ. την εξόφληση). Με `dedupeKey` το ίδιο email δεν φεύγει δεύτερη φορά.
 */
export async function sendMail(input: { to: string; mail: Mail; template: string; org?: Sender | null; dedupeKey?: string }): Promise<"SENT" | "FAILED" | "SKIPPED" | "DUPLICATE"> {
  const { to, mail, template, org } = input;
  if (input.dedupeKey && (await db.emailLog.findUnique({ where: { dedupeKey: input.dedupeKey } }))) return "DUPLICATE";
  const settings = await platformSettings();
  let status: "SENT" | "FAILED" | "SKIPPED" = "SKIPPED";
  let error: string | undefined;

  if (mailConfigured()) {
    const from = org ? `${headerName(org.emailFromName || org.name)} μέσω ${headerName(settings.brandName)} <${org.slug ?? "noreply"}@${mailDomain()}>` : `${headerName(settings.brandName)} <noreply@${mailDomain()}>`;
    const form = new URLSearchParams({ from, to, subject: mail.subject, html: mail.html, text: mail.text });
    const replyTo = org?.contactEmail ?? settings.supportEmail;
    if (replyTo) form.set("h:Reply-To", replyTo);
    try {
      const res = await fetch(`https://${host()}/v3/${mailDomain()}/messages`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}` },
        body: form,
        cache: "no-store",
      });
      status = res.ok ? "SENT" : "FAILED";
      if (!res.ok) error = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    } catch (e) {
      status = "FAILED";
      error = e instanceof Error ? e.message : String(e);
    }
  } else if (process.env.NODE_ENV !== "production") {
    // Τοπική ανάπτυξη χωρίς Mailgun: το κείμενο (με τους συνδέσμους) στην κονσόλα του server
    console.log(`\n[email που ΔΕΝ στάλθηκε → ${to}] ${mail.subject}\n${mail.text}\n`);
  }

  await db.emailLog.create({ data: { orgId: org?.id, to, template, subject: mail.subject, status, error, dedupeKey: status === "FAILED" ? null : input.dedupeKey } }).catch(() => {});
  return status;
}

/** Οι παραλήπτες των μηνυμάτων συνδρομής μιας επιχείρησης: το email επικοινωνίας και οι επιχειρηματίες. */
export async function billingRecipients(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, include: { members: { where: { role: { locked: true } }, include: { user: true } } } });
  if (!org) return { org: null, to: [] as string[] };
  return { org, to: [...new Set([org.contactEmail, ...org.members.map((m) => m.user.email)].filter((e): e is string => !!e))] };
}
