'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useApi, apiPost, apiDelete } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

export default function ParentStudentMapPage() {
  const { data: maps, loading, refetch } = useApi<any[]>('/api/admin/parent-student-map');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState('');
  const [form, setForm] = useState({ parent_id: '', student_id: '', relationship: 'father' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    await apiPost('/api/admin/parent-student-map', form);
    setSubmitting(false);
    setDialogOpen(false);
    setForm({ parent_id: '', student_id: '', relationship: 'father' });
    refetch();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    await apiDelete(`/api/admin/parent-student-map/${deleteId}`);
    setSubmitting(false);
    setDeleteOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'parent_id', header: 'Parent ID' },
    { accessorKey: 'student_id', header: 'Student ID' },
    {
      accessorKey: 'relationship',
      header: 'Relationship',
      cell: ({ row }) => <Badge variant="secondary" className="capitalize">{row.getValue('relationship')}</Badge>,
    },
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
      <PageHeader title="Parent-Student Map" description="Manage parent-student relationships">
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Mapping</Button>
      </PageHeader>
      <DataTable columns={columns} data={maps || []} searchKey="parent_id" searchPlaceholder="Search..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Parent-Student Mapping</DialogTitle>
            <DialogDescription>Link a parent to a student.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Parent ID</Label><Input value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} /></div>
            <div><Label>Student ID</Label><Input value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} /></div>
            <div>
              <Label>Relationship</Label>
              <Select value={form.relationship} onValueChange={(v) => setForm({ ...form, relationship: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="father">Father</SelectItem>
                  <SelectItem value="mother">Mother</SelectItem>
                  <SelectItem value="guardian">Guardian</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete Mapping" description="Remove this parent-student mapping?" onConfirm={handleDelete} loading={submitting} />
    </div>
  );
}
