'use client';

import { useApi } from '@/hooks/use-api';
import { StatCard } from '@/components/shared/stat-card';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { FolderOpen, ClipboardList, MessageSquare } from 'lucide-react';

export default function TeacherDashboard() {
  const { data: stats, loading } = useApi<any>('/api/teacher/stats');

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader title="Teacher Dashboard" description="Your teaching overview" />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Materials" value={stats?.totalMaterials || 0} icon={FolderOpen} description="Teaching materials uploaded" />
        <StatCard title="Assignment Templates" value={stats?.totalTemplates || 0} icon={ClipboardList} description="Templates created" />
        <StatCard title="Feedback Given" value={stats?.totalFeedback || 0} icon={MessageSquare} description="Student feedbacks" />
      </div>
    </div>
  );
}
