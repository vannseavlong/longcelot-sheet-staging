import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter, session) => {
    const profile = await adapter.table('profile').findOne({
      where: { student_id: session.user.userId },
    });
    return jsonResponse(profile);
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter, session) => {
    const body = await req.json();
    const count = await adapter.table('profile').update({
      where: { student_id: session.user.userId },
      data: body,
    });
    return jsonResponse({ updated: count });
  });
}
