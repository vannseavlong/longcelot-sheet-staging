'use client';

import { useApi } from '@/hooks/use-api';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User } from 'lucide-react';

export default function ChildrenPage() {
  const { data: children, loading } = useApi<any[]>('/api/parent/children');

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader title="My Children" description="Overview of your registered children" />
      {(!children || children.length === 0) ? (
        <EmptyState title="No children" description="No children have been linked to your account." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {children.map((child: any) => (
            <Card key={child._id || child.student_id}>
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{child.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">ID: {child.student_id}</p>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Badge variant="secondary">Grade {child.grade}</Badge>
                  {child.class && <Badge variant="outline">{child.class}</Badge>}
                  {child.relationship && <Badge variant="outline" className="capitalize">{child.relationship}</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
