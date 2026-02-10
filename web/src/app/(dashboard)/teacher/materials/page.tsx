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
import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function MaterialsPage() {
  const { data: materials, loading, refetch } = useApi<any[]>('/api/teacher/materials');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState('');
  const [form, setForm] = useState({ title: '', subject: '', description: '', file_url: '' });
  const [submitting, setSubmitting] = useState(false);

  const openCreate = () => {
    setEditItem(null);
    setForm({ title: '', subject: '', description: '', file_url: '' });
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ title: item.title, subject: item.subject, description: item.description || '', file_url: item.file_url });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    if (editItem) {
      await apiPut(`/api/teacher/materials/${editItem.material_id}`, form);
    } else {
      await apiPost('/api/teacher/materials', form);
    }
    setSubmitting(false);
    setDialogOpen(false);
    refetch();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    await apiDelete(`/api/teacher/materials/${deleteId}`);
    setSubmitting(false);
    setDeleteOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'subject', header: 'Subject' },
    { accessorKey: 'description', header: 'Description' },
    {
      accessorKey: 'file_url',
      header: 'File',
      cell: ({ row }) => row.getValue('file_url') ? (
        <a href={row.getValue('file_url') as string} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
          Open <ExternalLink className="h-3 w-3" />
        </a>
      ) : '-',
    },
    { accessorKey: 'uploaded_at', header: 'Uploaded', cell: ({ row }) => formatDate(row.getValue('uploaded_at')) },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => { setDeleteId(row.original.material_id); setDeleteOpen(true); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      ),
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Materials" description="Manage your teaching materials">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Material</Button>
      </PageHeader>
      <DataTable columns={columns} data={materials || []} searchKey="subject" searchPlaceholder="Search by subject..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Material' : 'Add Material'}</DialogTitle>
            <DialogDescription>{editItem ? 'Update material details.' : 'Upload a new teaching material.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Subject</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div><Label>File URL</Label><Input value={form.file_url} onChange={(e) => setForm({ ...form, file_url: e.target.value })} placeholder="https://drive.google.com/..." /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Material" description="Are you sure?" onConfirm={handleDelete} loading={submitting} />
    </div>
  );
}
