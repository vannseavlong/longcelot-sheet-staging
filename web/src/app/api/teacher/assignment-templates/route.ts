import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const templates = await adapter.table('assignment_templates').findMany({
      orderBy: 'due_date',
      order: 'desc',
    });
    return jsonResponse(templates);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const body = await req.json();
    if (!body.title || !body.subject || !body.due_date) {
      return errorResponse('title, subject, and due_date are required');
    }
    const record = await adapter.table('assignment_templates').create({
      assignment_id: `asn_${Date.now()}`,
      ...body,
    });
    return jsonResponse(record, 201);
  });
}
