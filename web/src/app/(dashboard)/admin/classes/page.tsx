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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';

export default function ClassesPage() {
  const { data: classes, loading, refetch } = useApi<any[]>('/api/admin/classes');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState('');
  const [form, setForm] = useState({ name: '', grade: '', homeroom_teacher: '', academic_year: '' });
  const [submitting, setSubmitting] = useState(false);

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: '', grade: '', homeroom_teacher: '', academic_year: '' });
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({ name: item.name, grade: item.grade, homeroom_teacher: item.homeroom_teacher || '', academic_year: item.academic_year || '' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    if (editItem) {
      await apiPut(`/api/admin/classes/${editItem.class_id}`, form);
    } else {
      await apiPost('/api/admin/classes', form);
    }
    setSubmitting(false);
    setDialogOpen(false);
    refetch();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    await apiDelete(`/api/admin/classes/${deleteId}`);
    setSubmitting(false);
    setDeleteOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'class_id', header: 'Class ID' },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'grade', header: 'Grade' },
    { accessorKey: 'homeroom_teacher', header: 'Homeroom Teacher' },
    { accessorKey: 'academic_year', header: 'Year' },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => { setDeleteId(row.original.class_id); setDeleteOpen(true); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      ),
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Classes" description="Manage school classes">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Class</Button>
      </PageHeader>
      <DataTable columns={columns} data={classes || []} searchKey="name" searchPlaceholder="Search classes..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Class' : 'Add Class'}</DialogTitle>
            <DialogDescription>{editItem ? 'Update class details.' : 'Create a new class.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Grade</Label><Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></div>
            <div><Label>Homeroom Teacher ID</Label><Input value={form.homeroom_teacher} onChange={(e) => setForm({ ...form, homeroom_teacher: e.target.value })} /></div>
            <div><Label>Academic Year</Label><Input value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2024-2025" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Class" description="Are you sure you want to delete this class?" onConfirm={handleDelete} loading={submitting} />
    </div>
  );
}
