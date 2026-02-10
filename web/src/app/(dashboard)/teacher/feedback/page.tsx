'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useApi, apiPost, apiPut } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Plus, Pencil } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function FeedbackPage() {
  const { data: feedback, loading, refetch } = useApi<any[]>('/api/teacher/feedback');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ student_id: '', assignment_id: '', comment: '', score: '' });
  const [submitting, setSubmitting] = useState(false);

  const openCreate = () => {
    setEditItem(null);
    setForm({ student_id: '', assignment_id: '', comment: '', score: '' });
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({
      student_id: item.student_id,
      assignment_id: item.assignment_id,
      comment: item.comment || '',
      score: item.score?.toString() || '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const data = { ...form, score: form.score ? Number(form.score) : undefined };
    if (editItem) {
      await apiPut(`/api/teacher/feedback/${editItem._id}`, data);
    } else {
      await apiPost('/api/teacher/feedback', data);
    }
    setSubmitting(false);
    setDialogOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'student_id', header: 'Student ID' },
    { accessorKey: 'assignment_id', header: 'Assignment ID' },
    { accessorKey: 'score', header: 'Score' },
    { accessorKey: 'comment', header: 'Comment' },
    { accessorKey: 'graded_at', header: 'Graded At', cell: ({ row }) => formatDate(row.getValue('graded_at')) },
    {
      id: 'actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Feedback" description="Grade and provide feedback to students">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Feedback</Button>
      </PageHeader>
      <DataTable columns={columns} data={feedback || []} searchKey="student_id" searchPlaceholder="Search by student..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Feedback' : 'Add Feedback'}</DialogTitle>
            <DialogDescription>{editItem ? 'Update feedback.' : 'Provide feedback for a student.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Student ID</Label><Input value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} disabled={!!editItem} /></div>
            <div><Label>Assignment ID</Label><Input value={form.assignment_id} onChange={(e) => setForm({ ...form, assignment_id: e.target.value })} disabled={!!editItem} /></div>
            <div><Label>Score</Label><Input type="number" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} /></div>
            <div><Label>Comment</Label><Textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
