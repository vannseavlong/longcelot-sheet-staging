'use client';

import { useApi } from '@/hooks/use-api';
import { StatCard } from '@/components/shared/stat-card';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { Users, GraduationCap, BookOpen, UserCheck } from 'lucide-react';

export default function AdminDashboard() {
  const { data: stats, loading } = useApi<any>('/api/admin/stats');

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader title="Admin Dashboard" description="System overview and management" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Users" value={stats?.totalUsers || 0} icon={Users} description="All registered users" />
        <StatCard title="Students" value={stats?.students || 0} icon={GraduationCap} />
        <StatCard title="Teachers" value={stats?.teachers || 0} icon={UserCheck} />
        <StatCard title="Classes" value={stats?.totalClasses || 0} icon={BookOpen} />
      </div>
    </div>
  );
}
