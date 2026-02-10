import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['parent'], async (_req, adapter) => {
    const children = await adapter.table('children').findMany({});
    const attendanceSummary = await adapter.table('attendance_summary').findMany({});
    const gradeSummary = await adapter.table('grade_summary').findMany({});

    const avgAttendance = attendanceSummary.length > 0
      ? Math.round(
          attendanceSummary.reduce((sum: number, a: any) => {
            const total = (a.present_days || 0) + (a.absent_days || 0) + (a.late_days || 0);
            return sum + (total > 0 ? ((a.present_days || 0) / total) * 100 : 0);
          }, 0) / attendanceSummary.length
        )
      : 0;

    const avgGpa = gradeSummary.length > 0
      ? (gradeSummary.reduce((sum: number, g: any) => sum + (g.gpa || 0), 0) / gradeSummary.length).toFixed(1)
      : '0.0';

    return jsonResponse({
      childrenCount: children.length,
      avgAttendance,
      avgGpa,
    });
  });
}
