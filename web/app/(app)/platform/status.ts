export const STATUS = {
  TRIALING: { tone: "warning", text: "Δοκιμαστική" },
  ACTIVE: { tone: "success", text: "Ενεργή" },
  PAST_DUE: { tone: "danger", text: "Ληξιπρόθεσμη" },
  CANCELLED: { tone: "neutral", text: "Ακυρωμένη" },
} as const;
