// Webhook της Viva για τις συνδρομές (λογαριασμός της πλατφόρμας, Smart Checkout).
// GET: η Viva ζητά το κλειδί επαλήθευσης όταν ορίζεται το webhook. POST: «Transaction Payment Created».
// Η Viva δεν υπογράφει τις ειδοποιήσεις: παίρνουμε μόνο το TransactionId και ρωτάμε τη Viva (settleVivaPayment).
// Απάντηση 200 = τελειωμένο (και για ό,τι απορρίπτεται, ώστε να μην ξαναστέλνεται). Μη-200 = η Viva ξαναπροσπαθεί.
import { settleVivaPayment } from "@/lib/billing";
import { rateLimited } from "@/lib/rate-limit";
import { webhookKey } from "@/lib/viva/checkout";

export async function GET() {
  try {
    return Response.json({ Key: await webhookKey() });
  } catch (e) {
    console.error(e);
    return new Response("not configured", { status: 503 });
  }
}

export async function POST(request: Request) {
  // κάθε κλήση κοστίζει ένα ερώτημα στη Viva: συνολικό όριο (το x-forwarded-for πλαστογραφείται)· η Viva ξαναστέλνει ό,τι κοπεί
  if (rateLimited("viva-webhook", 300, 60_000)) return new Response("slow down", { status: 429 });
  const body = (await request.json().catch(() => null)) as { EventData?: { TransactionId?: unknown } } | null;
  const result = await settleVivaPayment(body?.EventData?.TransactionId);
  return new Response(result, { status: result === "unknown" ? 503 : 200 });
}
