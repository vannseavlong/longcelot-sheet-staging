import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const body = await req.json();
    const count = await adapter.table('feedback').update({
      where: { _id: id },
      data: body,
    });
    if (count === 0) return errorResponse('Feedback not found', 404);
    return jsonResponse({ updated: count });
  });
}
