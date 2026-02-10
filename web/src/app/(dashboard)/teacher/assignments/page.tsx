'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useApi, apiPost, apiPut, apiDelete } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function AssignmentTemplatesPage() {
  const { data: templates, loading, refetch } = useApi<any[]>('/api/teacher/assignment-templates');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState('');
  const [form, setForm] = useState({ title: '', subject: '', description: '', due_date: '', max_score: '' });
  const [submitting, setSubmitting] = useState(false);

  const openCreate = () => {
    setEditItem(null);
    setForm({ title: '', subject: '', description: '', due_date: '', max_score: '' });
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ title: item.title, subject: item.subject, description: item.description || '', due_date: item.due_date || '', max_score: item.max_score || '' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    if (editItem) {
      await apiPut(`/api/teacher/assignment-templates/${editItem.assignment_id}`, form);
    } else {
      await apiPost('/api/teacher/assignment-templates', form);
    }
    setSubmitting(false);
    setDialogOpen(false);
    refetch();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    await apiDelete(`/api/teacher/assignment-templates/${deleteId}`);
    setSubmitting(false);
    setDeleteOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'subject', header: 'Subject' },
    { accessorKey: 'due_date', header: 'Due Date', cell: ({ row }) => formatDate(row.getValue('due_date')) },
    { accessorKey: 'max_score', header: 'Max Score' },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => { setDeleteId(row.original.assignment_id); setDeleteOpen(true); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      ),
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Assignment Templates" description="Create and manage assignment templates">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Create Template</Button>
      </PageHeader>
      <DataTable columns={columns} data={templates || []} searchKey="subject" searchPlaceholder="Search by subject..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Template' : 'Create Template'}</DialogTitle>
            <DialogDescription>{editItem ? 'Update assignment template.' : 'Create a new assignment template.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Subject</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            <div><Label>Max Score</Label><Input value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Template" description="Are you sure?" onConfirm={handleDelete} loading={submitting} />
    </div>
  );
}
