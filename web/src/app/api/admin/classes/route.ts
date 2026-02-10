import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const classes = await adapter.table('classes').findMany({});
    return jsonResponse(classes);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const body = await req.json();
    if (!body.name || !body.grade) {
      return errorResponse('Name and grade are required');
    }
    const classRecord = await adapter.table('classes').create({
      class_id: `class_${Date.now()}`,
      ...body,
    });
    return jsonResponse(classRecord, 201);
  });
}
