import { z } from "zod";
import { tillFromRequest } from "@/lib/device-auth";
import { AiError } from "@/lib/ai/openrouter";
import { OcrError } from "@/lib/ai/ocr";
import { deviceReceiving, readDeliveryNote } from "@/lib/receiving";

export const maxDuration = 60; // το μοντέλο όρασης θέλει μερικά δευτερόλεπτα

const body = z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().min(100).max(8_000_000) });

/** Φωτογραφία δελτίου αποστολής → αριθμός, προμηθευτής, γραμμές. Χρεώνεται ως μία σάρωση OCR. */
export async function POST(req: Request) {
  const ctx = await tillFromRequest(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid", message: "Η φωτογραφία δεν διαβάστηκε" }, { status: 400 });
  const { stock, denied } = await deviceReceiving(ctx);
  if (denied) return Response.json({ error: "role", message: denied }, { status: 403 });
  try {
    return Response.json(await readDeliveryNote(stock, parsed.data.mime, parsed.data.base64));
  } catch (e) {
    if (e instanceof AiError || e instanceof OcrError) return Response.json({ error: "ocr", message: e.message }, { status: 422 });
    throw e;
  }
}
