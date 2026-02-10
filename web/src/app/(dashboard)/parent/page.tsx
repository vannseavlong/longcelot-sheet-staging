'use client';

import { useApi } from '@/hooks/use-api';
import { StatCard } from '@/components/shared/stat-card';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { Baby, CalendarCheck, BarChart3 } from 'lucide-react';

export default function ParentDashboard() {
  const { data: stats, loading } = useApi<any>('/api/parent/stats');

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader title="Parent Dashboard" description="Your children's overview" />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Children" value={stats?.childrenCount || 0} icon={Baby} description="Registered children" />
        <StatCard title="Avg Attendance" value={`${stats?.avgAttendance || 0}%`} icon={CalendarCheck} description="Average attendance rate" />
        <StatCard title="Avg GPA" value={stats?.avgGpa || '0.0'} icon={BarChart3} description="Average GPA across children" />
      </div>
    </div>
  );
}
