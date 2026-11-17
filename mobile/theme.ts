// Ίδια χρώματα με το web (app/globals.css), μετατραπέντα από oklch σε hex για το React Native.
export const c = {
  background: "#F5F2EC",
  card: "#FFFFFF",
  foreground: "#333333",
  muted: "#66696F",
  primary: "#131F3B",
  gold: "#9F8757",
  success: "#3B8B5C",
  destructive: "#DE0013",
  secondary: "#F0F0F0",
  border: "rgba(19,31,59,0.12)",
};
export const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
