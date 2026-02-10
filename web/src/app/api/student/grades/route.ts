import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const grades = await adapter.table('grades').findMany({
      orderBy: 'subject',
    });
    return jsonResponse(grades);
  });
}
