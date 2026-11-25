import { handleDocumentRequest } from "@/lib/documents/route-handler";

type Context = { params: Promise<{ entityType: string; entityId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { entityType, entityId } = await params;
  return handleDocumentRequest(request, entityType, entityId);
}

export async function GET(request: Request, { params }: Context) {
  const { entityType, entityId } = await params;
  return handleDocumentRequest(request, entityType, entityId);
}
