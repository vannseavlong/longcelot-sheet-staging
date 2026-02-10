import { NextRequest } from 'next/server';
import { withAuth, jsonResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['student'], async (_req, adapter) => {
    const attendance = await adapter.table('attendance').findMany({});
    const assignments = await adapter.table('assignments').findMany({});
    const grades = await adapter.table('grades').findMany({});

    const presentCount = attendance.filter((a: any) => a.status === 'present').length;
    const attendanceRate = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 0;
    const pendingAssignments = assignments.filter((a: any) => a.status === 'pending').length;
    const avgScore = grades.length > 0 ? Math.round(grades.reduce((sum: number, g: any) => sum + (g.score || 0), 0) / grades.length) : 0;

    return jsonResponse({
      attendanceRate,
      totalAttendance: attendance.length,
      pendingAssignments,
      totalAssignments: assignments.length,
      averageScore: avgScore,
      totalGrades: grades.length,
    });
  });
}
