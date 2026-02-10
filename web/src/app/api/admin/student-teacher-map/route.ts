import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const maps = await adapter.table('student_teacher_map').findMany({});
    return jsonResponse(maps);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const body = await req.json();
    if (!body.student_id || !body.teacher_id || !body.subject) {
      return errorResponse('student_id, teacher_id, and subject are required');
    }
    const record = await adapter.table('student_teacher_map').create(body);
    return jsonResponse(record, 201);
  });
}
