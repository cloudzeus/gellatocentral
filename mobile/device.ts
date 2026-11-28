import { Dimensions } from "react-native";

/**
 * Είδος συσκευής, όχι πλάτος παραθύρου: η μικρότερη πλευρά της οθόνης δεν αλλάζει με την περιστροφή.
 * Κανόνας Android sw600dp: ≥ 600dp = tablet. Έτσι κινητό στο πλάι μένει κινητό και tablet όρθιο μένει tablet.
 */
export const deviceKind = (): "tablet" | "phone" => {
  const { width, height } = Dimensions.get("screen");
  return Math.min(width, height) >= 600 ? "tablet" : "phone";
};
