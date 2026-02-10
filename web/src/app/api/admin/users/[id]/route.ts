import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const user = await adapter.table('users').findOne({
      where: { user_id: id },
    });
    if (!user) return errorResponse('User not found', 404);
    return jsonResponse(user);
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const body = await req.json();
    const count = await adapter.table('users').update({
      where: { user_id: id },
      data: body,
    });
    if (count === 0) return errorResponse('User not found', 404);
    return jsonResponse({ updated: count });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const count = await adapter.table('users').update({
      where: { user_id: id },
      data: { status: 'inactive' },
    });
    return jsonResponse({ updated: count });
  });
}
