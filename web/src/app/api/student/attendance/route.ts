import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const records = await adapter.table('attendance').findMany({
      orderBy: 'date',
      order: 'desc',
    });
    return jsonResponse(records);
  });
}
