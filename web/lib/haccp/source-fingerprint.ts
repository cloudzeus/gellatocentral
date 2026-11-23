import { createHash } from "node:crypto";

// Στις HTML σελίδες αποτυπώνουμε το ορατό κείμενο· tokens/scripts που αλλάζουν ανά request
// δεν πρέπει να παράγουν ψευδή «νομική αλλαγή». Στα PDF μετράμε τα πραγματικά bytes.
export function sourceFingerprint(contentType: string, data: Uint8Array) {
  let content: Uint8Array = data;
  if (contentType.includes("html")) {
    const text = new TextDecoder().decode(data)
      .replace(/<!--[\s\S]*?-->/gi, " ")
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    content = new TextEncoder().encode(text);
  }
  return createHash("sha256").update(content).digest("hex");
}
