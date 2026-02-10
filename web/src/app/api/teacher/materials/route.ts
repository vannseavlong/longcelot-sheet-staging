import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const materials = await adapter.table('materials').findMany({
      orderBy: 'uploaded_at',
      order: 'desc',
    });
    return jsonResponse(materials);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const body = await req.json();
    if (!body.title || !body.subject || !body.file_url) {
      return errorResponse('title, subject, and file_url are required');
    }
    const record = await adapter.table('materials').create({
      material_id: `mat_${Date.now()}`,
      uploaded_at: new Date().toISOString(),
      ...body,
    });
    return jsonResponse(record, 201);
  });
}
