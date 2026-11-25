import { handleDocumentDeliveryRequest } from "@/lib/documents/delivery-route";

type Context = { params: Promise<{ entityType: string; entityId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { entityType, entityId } = await params;
  return handleDocumentDeliveryRequest(request, entityType, entityId);
}

export async function POST(request: Request, { params }: Context) {
  const { entityType, entityId } = await params;
  return handleDocumentDeliveryRequest(request, entityType, entityId);
}
