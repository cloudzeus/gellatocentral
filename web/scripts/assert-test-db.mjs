// Τα integration tests γράφουν οργανισμούς και χρήστες στη βάση του DATABASE_URL: τρέχουν μόνο σε δοκιμαστική βάση.
// shortcut: ο έλεγχος είναι στο npm script· όποιος τρέξει αρχείο μόνο του με tsx τον παρακάμπτει.
const raw = process.env.DATABASE_URL;
if (!raw) { console.error("Λείπει το DATABASE_URL (δοκιμαστική βάση)."); process.exit(1); }
const url = new URL(raw);
const name = url.pathname.slice(1);
const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
if (!local && !/_(test|audit)$/.test(name)) {
  console.error(`Άρνηση: η βάση «${name}» στο ${url.hostname} δεν είναι δοκιμαστική (τοπικός host ή όνομα που τελειώνει σε _test/_audit).`);
  process.exit(1);
}
