'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useApi, apiPost, apiDelete } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';

export default function StudentTeacherMapPage() {
  const { data: maps, loading, refetch } = useApi<any[]>('/api/admin/student-teacher-map');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState('');
  const [form, setForm] = useState({ student_id: '', teacher_id: '', subject: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    await apiPost('/api/admin/student-teacher-map', form);
    setSubmitting(false);
    setDialogOpen(false);
    setForm({ student_id: '', teacher_id: '', subject: '' });
    refetch();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    await apiDelete(`/api/admin/student-teacher-map/${deleteId}`);
    setSubmitting(false);
    setDeleteOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'student_id', header: 'Student ID' },
    { accessorKey: 'teacher_id', header: 'Teacher ID' },
    { accessorKey: 'subject', header: 'Subject' },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => { setDeleteId(row.original._id); setDeleteOpen(true); }}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Student-Teacher Map" description="Manage student-teacher assignments">
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Mapping</Button>
      </PageHeader>
      <DataTable columns={columns} data={maps || []} searchKey="subject" searchPlaceholder="Search by subject..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Student-Teacher Mapping</DialogTitle>
            <DialogDescription>Link a student to a teacher for a subject.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Student ID</Label><Input value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} /></div>
            <div><Label>Teacher ID</Label><Input value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} /></div>
            <div><Label>Subject</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Mapping" description="Remove this student-teacher mapping?" onConfirm={handleDelete} loading={submitting} />
    </div>
  );
}
