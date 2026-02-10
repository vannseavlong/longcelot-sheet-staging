import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const notices = await adapter.table('notices').findMany({
      orderBy: 'published_at',
      order: 'desc',
    });
    return jsonResponse(notices);
  });
}
