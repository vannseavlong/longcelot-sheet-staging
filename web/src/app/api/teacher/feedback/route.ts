import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const feedback = await adapter.table('feedback').findMany({
      orderBy: 'graded_at',
      order: 'desc',
    });
    return jsonResponse(feedback);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const body = await req.json();
    if (!body.student_id || !body.assignment_id) {
      return errorResponse('student_id and assignment_id are required');
    }
    const record = await adapter.table('feedback').create({
      graded_at: new Date().toISOString(),
      ...body,
    });
    return jsonResponse(record, 201);
  });
}
