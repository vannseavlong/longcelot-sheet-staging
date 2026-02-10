import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const count = await adapter.table('parent_student_map').delete({
      where: { _id: id },
    });
    return jsonResponse({ deleted: count });
  });
}
