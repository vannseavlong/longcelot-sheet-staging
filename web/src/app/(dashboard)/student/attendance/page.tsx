'use client';

import { ColumnDef } from '@tanstack/react-table';
import { useApi } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';

const statusVariant: Record<string, string> = {
  present: 'success',
  absent: 'destructive',
  late: 'warning',
  excused: 'secondary',
};

export default function AttendancePage() {
  const { data: records, loading } = useApi<any[]>('/api/student/attendance');

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'date', header: 'Date', cell: ({ row }) => formatDate(row.getValue('date')) },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string;
        return <Badge variant={(statusVariant[status] || 'outline') as any} className="capitalize">{status}</Badge>;
      },
    },
    { accessorKey: 'remark', header: 'Remark' },
    { accessorKey: 'marked_by', header: 'Marked By' },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Attendance" description="Your attendance records" />
      <DataTable columns={columns} data={records || []} searchKey="status" searchPlaceholder="Filter by status..." />
    </div>
  );
}
