import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['parent'], async (_req, adapter) => {
    const summary = await adapter.table('grade_summary').findMany({});
    return jsonResponse(summary);
  });
}
