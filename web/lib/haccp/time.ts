// Τοπική ώρα Ελλάδας σε μορφή datetime-local· κρατά τον Server Component καθαρό.
export function currentAthensInput(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(" ", "T");
}
