'use client';

import { ColumnDef } from '@tanstack/react-table';
import { useApi } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';

export default function ParentAttendancePage() {
  const { data: summary, loading } = useApi<any[]>('/api/parent/attendance-summary');

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'student_id', header: 'Student ID' },
    { accessorKey: 'month', header: 'Month' },
    { accessorKey: 'present_days', header: 'Present Days' },
    { accessorKey: 'absent_days', header: 'Absent Days' },
    { accessorKey: 'late_days', header: 'Late Days' },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Attendance Summary" description="Monthly attendance overview for your children" />
      <DataTable columns={columns} data={summary || []} searchKey="student_id" searchPlaceholder="Filter by student..." />
    </div>
  );
}
