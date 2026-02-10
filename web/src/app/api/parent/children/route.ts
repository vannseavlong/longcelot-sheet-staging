import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['parent'], async (_req, adapter) => {
    const children = await adapter.table('children').findMany({});
    return jsonResponse(children);
  });
}
