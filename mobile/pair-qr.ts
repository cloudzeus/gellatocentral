// Το QR σύνδεσης της κονσόλας: https://<server>/api/pos/pair?code=<8 χαρακτήρες>. Δίνει διεύθυνση και κωδικό.
export function parsePairQr(text: string): { baseUrl: string; code: string } | null {
  let url: URL;
  try { url = new URL(text.trim()); } catch { return null; }
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  if (!/^\/api\/pos\/pair\/?$/.test(url.pathname) || !/^[A-Z0-9]{8}$/.test(code)) return null;
  return { baseUrl: url.origin, code };
}
