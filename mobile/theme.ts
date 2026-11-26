import type { TextStyle } from "react-native";

// Design system του ταμείου Android: σκούρο γραφίτη, παστέλ χρώμα ανά κατηγορία (docs/mockups/central-till/central-till-cosy.html).
// Ένα θέμα, σκούρο. Κανένα χρώμα εκτός αυτού του πίνακα.
export type Theme = typeof dark;

// 8 θέσεις χρώματος κατηγορίας (Category.color 1–8). Παστέλ, πάντα με σκούρο κείμενο (ink).
const pastel = ["#D9DADD", "#C9CAEE", "#CDE5DB", "#F0D2C4", "#C8DAEA", "#E6DECB", "#DDE9C4", "#EBCAD8"];

export const dark = {
  bg: "#111315", panel: "#1A1C1F", card: "#212428", raised: "#2A2D32", line: "rgba(255,255,255,0.08)", divider: "rgba(255,255,255,0.12)", // divider: γραμμή διαχωρισμού γραμμών/ενοτήτων, λίγο πιο ορατή από το line
  text: "#FAFAFA", muted: "#B4B7BD", faint: "#787C84", ink: "#121417",
  action: "#F4F4F5", onAction: "#121417",
  bad: "#F28B8B", wait: "#F2C46D", ok: "#7FD1A1",
  categories: pastel,
};

/** Το ίδιο χρώμα στο 14%, για το φόντο της ετικέτας κατάστασης. Δέχεται μόνο τα #RRGGBB του πίνακα. */
export const tint = (hex: string) => `${hex}24`;

/** Inter Tight: καθαρή, σφιχτή, με ελληνικά. Στο Android το βάρος αλλάζει μόνο με άλλη οικογένεια, όχι με fontWeight. */
export const font = { r: "InterTight_400Regular", m: "InterTight_500Medium", s: "InterTight_600SemiBold", b: "InterTight_700Bold" } as const;

export const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

/**
 * Μέγεθος κειμένου: όλη η εφαρμογή γράφει ~8% πιο μικρά από τα mockups (πυκνότητα στο tablet του ταμείου),
 * ποτέ κάτω από 11.5. Τα μεγέθη στον κώδικα μένουν όπως στα mockups· η κλίμακα εφαρμόζεται μόνο εδώ.
 */
export const fs = (size: number) => Math.max(11.5, Math.round(size * 0.92 * 2) / 2);
export const ty = (size: number, w: keyof typeof font, color: string): TextStyle => ({ fontSize: fs(size), fontFamily: font[w], color, includeFontPadding: false });
