// Όλα τα email της πλατφόρμας. Καθαρές συναρτήσεις: δεδομένα → { subject, html, text }.
// Τα προγράμματα email δεν καταλαβαίνουν oklch/CSS variables: χρώματα σε hex, διάταξη με πίνακες, inline styles.

const C = { navy: "#131F3B", gold: "#9F8757", bg: "#F5F2EC", card: "#FFFFFF", text: "#333333", muted: "#66696F", border: "#E3DFD6", success: "#3B8B5C", danger: "#C4001A" };

/** Ό,τι προέρχεται από χρήστη (επωνυμίες, ονόματα) περνά από εδώ πριν μπει στο HTML. */
export const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const euro = (cents: number) => new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(cents / 100);
const day = (d: Date) => d.toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Athens" });

type Row = [label: string, value: string];
type Body = { preheader: string; title: string; paragraphs: string[]; rows?: Row[]; button?: { label: string; url: string }; note?: string; tone?: "success" | "danger" };
export type Brand = { brandName: string; supportEmail?: string | null };
export type Mail = { subject: string; html: string; text: string };

function layout(brand: Brand, b: Body): Pick<Mail, "html" | "text"> {
  const accent = b.tone === "success" ? C.success : b.tone === "danger" ? C.danger : C.gold;
  const rows = b.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border:1px solid ${C.border};border-radius:12px">${b.rows
        .map(([l, v], i) => `<tr><td style="padding:12px 16px;font-size:14px;color:${C.muted};${i ? `border-top:1px solid ${C.border}` : ""}">${esc(l)}</td><td align="right" style="padding:12px 16px;font-size:14px;font-weight:700;color:${C.text};${i ? `border-top:1px solid ${C.border}` : ""}">${esc(v)}</td></tr>`)
        .join("")}</table>`
    : "";
  const button = b.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:12px;background:${C.navy}"><a href="${esc(b.button.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none">${esc(b.button.label)}</a></td></tr></table>
       <p style="margin:0 0 20px;font-size:12px;line-height:18px;color:${C.muted}">Αν το κουμπί δεν ανοίγει, αντίγραψε αυτή τη διεύθυνση στον browser:<br><span style="word-break:break-all">${esc(b.button.url)}</span></p>`
    : "";
  const html = `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:'Nunito Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(b.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="background:${C.navy};border-radius:16px 16px 0 0;padding:24px 32px;font-size:20px;font-weight:800;letter-spacing:0.5px;color:#FFFFFF">${esc(brand.brandName)}</td></tr>
    <tr><td style="height:4px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="background:${C.card};border-radius:0 0 16px 16px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:800;color:${C.navy}">${esc(b.title)}</h1>
      ${b.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px">${esc(p)}</p>`).join("")}
      ${rows}${button}
      ${b.note ? `<p style="margin:0;font-size:13px;line-height:20px;color:${C.muted}">${esc(b.note)}</p>` : ""}
    </td></tr>
    <tr><td align="center" style="padding:20px 16px;font-size:12px;line-height:18px;color:${C.muted}">${esc(brand.brandName)}${brand.supportEmail ? ` · Βοήθεια: <a href="mailto:${esc(brand.supportEmail)}" style="color:${C.muted}">${esc(brand.supportEmail)}</a>` : ""}</td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = [b.title, "", ...b.paragraphs, "", ...(b.rows ?? []).map(([l, v]) => `${l}: ${v}`), b.button ? `\n${b.button.label}: ${b.button.url}` : "", b.note ?? "", "", brand.brandName].filter((l) => l !== undefined).join("\n");
  return { html, text };
}

const mail = (brand: Brand, subject: string, body: Body): Mail => ({ subject, ...layout(brand, body) });
type Charge = { orgName: string; periodStart: Date; periodEnd: Date; stores: number; devices: number; amountCents: number };
const chargeRows = (c: Charge): Row[] => [
  ["Περίοδος", `${day(c.periodStart)} – ${day(c.periodEnd)}`],
  ["Καταστήματα", String(c.stores)],
  ["Ταμεία", String(c.devices)],
  ["Ποσό (προ ΦΠΑ)", euro(c.amountCents)],
];

export const templates = {
  passwordReset: (b: Brand, d: { name: string; url: string }) =>
    mail(b, "Αλλαγή κωδικού", {
      preheader: "Ο σύνδεσμος ισχύει για 1 ώρα",
      title: "Αλλαγή κωδικού",
      paragraphs: [`Γεια σου ${d.name},`, "Ζητήθηκε αλλαγή του κωδικού σου. Πάτησε το κουμπί για να ορίσεις νέο."],
      button: { label: "Ορισμός νέου κωδικού", url: d.url },
      note: "Ο σύνδεσμος ισχύει για 1 ώρα και μόνο για μία χρήση. Αν δεν το ζήτησες εσύ, αγνόησε αυτό το μήνυμα: ο κωδικός σου δεν αλλάζει.",
    }),

  invitation: (b: Brand, d: { name: string; orgName: string; role: string; url: string }) =>
    mail(b, `Πρόσκληση στο ${d.orgName}`, {
      preheader: "Όρισε τον κωδικό σου για να μπεις",
      title: `Καλώς ήρθες στο ${d.orgName}`,
      paragraphs: [`Γεια σου ${d.name},`, `Σου δόθηκε πρόσβαση στο ${b.brandName} της επιχείρησης ${d.orgName}, με ρόλο «${d.role}». Για να μπεις, όρισε τον κωδικό σου.`],
      button: { label: "Ορισμός κωδικού", url: d.url },
      note: "Ο σύνδεσμος ισχύει για 72 ώρες. Αν λήξει, πάτησε «Ξέχασα τον κωδικό» στη σελίδα σύνδεσης.",
    }),

  welcome: (b: Brand, d: { orgName: string; trialEnds: Date; url: string }) =>
    mail(b, `Η ${d.orgName} είναι έτοιμη`, {
      preheader: `Δοκιμαστική περίοδος μέχρι ${day(d.trialEnds)}`,
      title: "Ο λογαριασμός σας είναι έτοιμος",
      paragraphs: [`Η επιχείρηση ${d.orgName} δημιουργήθηκε στο ${b.brandName}.`, `Η δοκιμαστική περίοδος ισχύει μέχρι ${day(d.trialEnds)}. Σε αυτό το διάστημα μπορείτε να χρησιμοποιήσετε όλες τις λειτουργίες χωρίς χρέωση.`],
      button: { label: "Είσοδος στην εφαρμογή", url: d.url },
    }),

  chargeIssued: (b: Brand, d: Charge & { payUrl?: string }) =>
    mail(b, `Συνδρομή ${d.orgName}: ${euro(d.amountCents)} για την επόμενη περίοδο`, {
      preheader: `Πληρωτέο μέχρι ${day(d.periodStart)}`,
      title: "Η συνδρομή του επόμενου μήνα",
      paragraphs: [`Εκδόθηκε η χρέωση της συνδρομής για την επιχείρηση ${d.orgName}.`],
      rows: chargeRows(d),
      button: d.payUrl ? { label: "Πληρωμή με κάρτα", url: d.payUrl } : undefined,
      note: `Για να συνεχίσει η εφαρμογή χωρίς διακοπή, η πληρωμή πρέπει να γίνει μέχρι ${day(d.periodStart)}. Αυτό το μήνυμα είναι ενημέρωση, όχι φορολογικό παραστατικό.`,
    }),

  paymentReceived: (b: Brand, d: Charge) =>
    mail(b, `Λάβαμε την πληρωμή σας — ${d.orgName}`, {
      preheader: `Η συνδρομή ισχύει μέχρι ${day(d.periodEnd)}`,
      title: "Η πληρωμή καταχωρήθηκε",
      paragraphs: [`Ευχαριστούμε. Η συνδρομή της επιχείρησης ${d.orgName} ισχύει πλέον μέχρι ${day(d.periodEnd)}.`],
      rows: chargeRows(d),
      tone: "success",
    }),

  trialEnding: (b: Brand, d: { orgName: string; endsAt: Date; daysLeft: number; monthlyCents: number }) =>
    mail(b, `Η δοκιμή της ${d.orgName} λήγει σε ${d.daysLeft} ${d.daysLeft === 1 ? "ημέρα" : "ημέρες"}`, {
      preheader: `Λήγει στις ${day(d.endsAt)}`,
      title: "Η δοκιμαστική περίοδος τελειώνει",
      paragraphs: [`Η δοκιμαστική περίοδος της επιχείρησης ${d.orgName} λήγει στις ${day(d.endsAt)}.`, "Για να συνεχίσετε χωρίς διακοπή, επικοινωνήστε μαζί μας για την ενεργοποίηση της συνδρομής. Τα δεδομένα σας μένουν όπως είναι."],
      rows: [["Συνδρομή με τη σημερινή σας χρήση", `${euro(d.monthlyCents)} τον μήνα, προ ΦΠΑ`]],
    }),

  subscriptionExpired: (b: Brand, d: { orgName: string; endedAt: Date }) =>
    mail(b, `Η συνδρομή της ${d.orgName} έληξε`, {
      preheader: "Χρειάζεται ανανέωση για να συνεχίσει η έκδοση αποδείξεων",
      title: "Η συνδρομή έληξε",
      paragraphs: [`Η συνδρομή της επιχείρησης ${d.orgName} έληξε στις ${day(d.endedAt)}.`, "Επικοινωνήστε μαζί μας για την ανανέωση. Τα δεδομένα σας δεν χάνονται."],
      tone: "danger",
    }),

  test: (b: Brand, d: { to: string }) =>
    mail(b, "Δοκιμαστικό email", {
      preheader: "Η σύνδεση με το Mailgun δουλεύει",
      title: "Η αποστολή email δουλεύει",
      paragraphs: [`Αυτό το μήνυμα στάλθηκε στο ${d.to} από τις ρυθμίσεις της πλατφόρμας. Αν το διαβάζεις, το Mailgun είναι σωστά ρυθμισμένο.`],
      tone: "success",
    }),
};

export const TEMPLATE_LABEL: Record<keyof typeof templates, string> = {
  passwordReset: "Ανάκτηση κωδικού",
  invitation: "Πρόσκληση χρήστη",
  welcome: "Νέα επιχείρηση",
  chargeIssued: "Έκδοση χρέωσης συνδρομής",
  paymentReceived: "Επιβεβαίωση πληρωμής",
  trialEnding: "Λήξη δοκιμής σε λίγες ημέρες",
  subscriptionExpired: "Η συνδρομή έληξε",
  test: "Δοκιμαστικό",
};

/** Δείγματα για την προεπισκόπηση στις ρυθμίσεις. */
export function samples(b: Brand): Record<keyof typeof templates, Mail> {
  const charge: Charge = { orgName: "Gelateria Aurora", periodStart: new Date("2026-12-01"), periodEnd: new Date("2027-01-01"), stores: 2, devices: 3, amountCents: 16300 };
  const url = "https://aurora.gelatosystem.app/reset?token=δείγμα";
  return {
    passwordReset: templates.passwordReset(b, { name: "Μαρία", url }),
    invitation: templates.invitation(b, { name: "Μαρία", orgName: "Gelateria Aurora", role: "Ταμίας", url }),
    welcome: templates.welcome(b, { orgName: "Gelateria Aurora", trialEnds: new Date("2026-11-30"), url: "https://aurora.gelatosystem.app" }),
    chargeIssued: templates.chargeIssued(b, { ...charge, payUrl: "https://aurora.gelatosystem.app/billing" }),
    paymentReceived: templates.paymentReceived(b, charge),
    trialEnding: templates.trialEnding(b, { orgName: "Gelateria Aurora", endsAt: new Date("2026-11-30"), daysLeft: 3, monthlyCents: 16300 }),
    subscriptionExpired: templates.subscriptionExpired(b, { orgName: "Gelateria Aurora", endedAt: new Date("2026-11-30") }),
    test: templates.test(b, { to: "you@example.com" }),
  };
}
