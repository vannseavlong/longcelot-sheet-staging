import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const timetable = await adapter.table('timetable').findMany({});
    return jsonResponse(timetable);
  });
}
