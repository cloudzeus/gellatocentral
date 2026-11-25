// Βάση design system των εφαρμογών Android (docs/design/spec-central-till-package-1.md).
// Δύο θέματα με την ίδια διάταξη: αλλάζουν μόνο τα χρώματα. Κανένα χρώμα εκτός αυτού του πίνακα.
export type Theme = typeof dark;

export const dark = {
  bg: "#0B0F18", panel: "#121721", raised: "#1C2330", line: "rgba(255,255,255,0.085)",
  text: "#E9EBEF", muted: "#989FAB", faint: "#636975",
  action: "#D5B676", onAction: "#1C1505",
  bad: "#F66C6D", wait: "#E9B452", ok: "#62C689",
  // Χρώματα κατηγορίας: ίδια φωτεινότητα και ένταση, αλλάζει μόνο η απόχρωση. Λευκό κείμενο.
  categories: ["#5D646F", "#7F5C25", "#296B8D", "#1C7360", "#854F6E", "#815849", "#6B588D", "#546480"],
};
export const light: Theme = {
  bg: "#F5F3F0", panel: "#FFFFFF", raised: "#EAE8E3", line: "rgba(26,34,48,0.11)",
  text: "#1A2230", muted: "#5D646F", faint: "#9399A2",
  action: "#131F3B", onAction: "#FAF8F5",
  bad: "#C21725", wait: "#915200", ok: "#036639",
  categories: ["#575E69", "#79561E", "#226587", "#136D5B", "#7F4969", "#7B5244", "#655286", "#4E5E7A"],
};

/** Το ίδιο χρώμα στο 14%, για το φόντο της ετικέτας κατάστασης. Δέχεται μόνο τα #RRGGBB του πίνακα. */
export const tint = (hex: string) => `${hex}24`;

export const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
