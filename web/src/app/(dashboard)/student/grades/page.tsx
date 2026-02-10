'use client';

import { ColumnDef } from '@tanstack/react-table';
import { useApi } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function GradesPage() {
  const { data: grades, loading } = useApi<any[]>('/api/student/grades');

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'subject', header: 'Subject' },
    { accessorKey: 'score', header: 'Score' },
    {
      accessorKey: 'grade',
      header: 'Grade',
      cell: ({ row }) => <Badge variant="outline">{row.getValue('grade') || '-'}</Badge>,
    },
    { accessorKey: 'teacher_comment', header: 'Comment' },
  ];

  if (loading) return <TableSkeleton />;

  const terms = ['1', '2', '3', 'final'];
  const gradesByTerm: Record<string, any[]> = {};
  terms.forEach((t) => { gradesByTerm[t] = (grades || []).filter((g: any) => g.term === t); });

  return (
    <div>
      <PageHeader title="Grades" description="View your academic grades" />
      <Tabs defaultValue="1">
        <TabsList>
          {terms.map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t === 'final' ? 'Final' : `Term ${t}`}
            </TabsTrigger>
          ))}
        </TabsList>
        {terms.map((t) => (
          <TabsContent key={t} value={t}>
            <DataTable columns={columns} data={gradesByTerm[t]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
