import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['parent'], async (_req, adapter) => {
    const summary = await adapter.table('attendance_summary').findMany({
      orderBy: 'month',
      order: 'desc',
    });
    return jsonResponse(summary);
  });
}
