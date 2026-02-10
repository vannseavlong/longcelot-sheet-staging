'use client';

import { ColumnDef } from '@tanstack/react-table';
import { useApi } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Badge } from '@/components/ui/badge';

export default function ParentGradesPage() {
  const { data: summary, loading } = useApi<any[]>('/api/parent/grade-summary');

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'student_id', header: 'Student ID' },
    {
      accessorKey: 'term',
      header: 'Term',
      cell: ({ row }) => {
        const term = row.getValue('term') as string;
        return <Badge variant="outline">{term === 'final' ? 'Final' : `Term ${term}`}</Badge>;
      },
    },
    { accessorKey: 'gpa', header: 'GPA' },
    { accessorKey: 'rank', header: 'Rank' },
    { accessorKey: 'total_subjects', header: 'Subjects' },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Grade Summary" description="Academic performance of your children" />
      <DataTable columns={columns} data={summary || []} searchKey="student_id" searchPlaceholder="Filter by student..." />
    </div>
  );
}
