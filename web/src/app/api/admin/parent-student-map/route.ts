import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const maps = await adapter.table('parent_student_map').findMany({});
    return jsonResponse(maps);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const body = await req.json();
    if (!body.parent_id || !body.student_id) {
      return errorResponse('parent_id and student_id are required');
    }
    const record = await adapter.table('parent_student_map').create(body);
    return jsonResponse(record, 201);
  });
}
