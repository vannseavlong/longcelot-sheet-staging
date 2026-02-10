import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const body = await req.json();
    const count = await adapter.table('materials').update({
      where: { material_id: id },
      data: body,
    });
    if (count === 0) return errorResponse('Material not found', 404);
    return jsonResponse({ updated: count });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const count = await adapter.table('materials').delete({
      where: { material_id: id },
    });
    return jsonResponse({ deleted: count });
  });
}
