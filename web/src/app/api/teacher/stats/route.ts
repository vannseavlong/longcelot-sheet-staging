import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['teacher'], async (_req, adapter) => {
    const materials = await adapter.table('materials').findMany({});
    const templates = await adapter.table('assignment_templates').findMany({});
    const feedback = await adapter.table('feedback').findMany({});

    return jsonResponse({
      totalMaterials: materials.length,
      totalTemplates: templates.length,
      totalFeedback: feedback.length,
    });
  });
}
