import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const assignments = await adapter.table('assignments').findMany({
      orderBy: 'due_date',
      order: 'desc',
    });
    return jsonResponse(assignments);
  });
}

export async function PUT(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const body = await req.json();
    const { assignment_id, ...data } = body;
    const count = await adapter.table('assignments').update({
      where: { assignment_id },
      data: { ...data, status: 'submitted', submitted_at: new Date().toISOString() },
    });
    return jsonResponse({ updated: count });
  });
}
