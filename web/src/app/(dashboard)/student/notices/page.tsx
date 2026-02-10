'use client';

import { useApi } from '@/hooks/use-api';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';

export default function NoticesPage() {
  const { data: notices, loading } = useApi<any[]>('/api/student/notices');

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader title="Notices" description="Announcements and notifications" />
      {(!notices || notices.length === 0) ? (
        <EmptyState title="No notices" description="No notices have been posted yet." />
      ) : (
        <div className="space-y-4">
          {notices.map((notice: any) => (
            <Card key={notice._id || notice.notice_id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{notice.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize">{notice.from_role}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(notice.published_at)}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{notice.message}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
