'use client';

import { useApi } from '@/hooks/use-api';
import { StatCard } from '@/components/shared/stat-card';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { CalendarCheck, FileText, GraduationCap, BarChart3 } from 'lucide-react';

export default function StudentDashboard() {
  const { data: stats, loading } = useApi<any>('/api/student/stats');

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader title="Student Dashboard" description="Your academic overview" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Attendance Rate" value={`${stats?.attendanceRate || 0}%`} icon={CalendarCheck} description={`${stats?.totalAttendance || 0} total days`} />
        <StatCard title="Pending Assignments" value={stats?.pendingAssignments || 0} icon={FileText} description={`${stats?.totalAssignments || 0} total`} />
        <StatCard title="Average Score" value={stats?.averageScore || 0} icon={GraduationCap} description={`${stats?.totalGrades || 0} graded subjects`} />
        <StatCard title="Grade Count" value={stats?.totalGrades || 0} icon={BarChart3} />
      </div>
    </div>
  );
}
