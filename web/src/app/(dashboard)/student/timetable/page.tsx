'use client';

import { useApi } from '@/hooks/use-api';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardSkeleton } from '@/components/shared/loading-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS: Record<string, string> = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri' };

export default function TimetablePage() {
  const { data: timetable, loading } = useApi<any[]>('/api/student/timetable');

  if (loading) return <DashboardSkeleton />;

  const grouped: Record<string, any[]> = {};
  DAYS.forEach((d) => { grouped[d] = []; });
  (timetable || []).forEach((entry: any) => {
    const day = (entry.day || '').toLowerCase();
    if (grouped[day]) grouped[day].push(entry);
  });

  // Sort each day by start_time
  DAYS.forEach((d) => { grouped[d].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')); });

  return (
    <div>
      <PageHeader title="Timetable" description="Your weekly schedule" />
      <div className="grid gap-4 md:grid-cols-5">
        {DAYS.map((day) => (
          <Card key={day}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase">{DAY_LABELS[day]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {grouped[day].length === 0 ? (
                <p className="text-xs text-muted-foreground">No classes</p>
              ) : (
                grouped[day].map((entry, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-2">
                    <p className="font-medium text-sm">{entry.subject}</p>
                    <p className="text-xs text-muted-foreground">{entry.start_time} - {entry.end_time}</p>
                    {entry.room && <p className="text-xs text-muted-foreground">Room: {entry.room}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
