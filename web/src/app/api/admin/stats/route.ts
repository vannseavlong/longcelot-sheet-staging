import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const users = await adapter.table('users').findMany({});
    const classes = await adapter.table('classes').findMany({});
    const mappings = await adapter.table('student_teacher_map').findMany({});

    const stats = {
      totalUsers: users.length,
      students: users.filter((u: any) => u.role === 'student').length,
      teachers: users.filter((u: any) => u.role === 'teacher').length,
      parents: users.filter((u: any) => u.role === 'parent').length,
      activeUsers: users.filter((u: any) => u.status === 'active').length,
      totalClasses: classes.length,
      totalMappings: mappings.length,
    };

    return jsonResponse(stats);
  });
}
