'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useApi, apiPost, apiPut, apiDelete } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function UsersPage() {
  const { data: users, loading, refetch } = useApi<any[]>('/api/admin/users');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteId, setDeleteId] = useState('');
  const [form, setForm] = useState({ email: '', role: 'student', status: 'active' });
  const [submitting, setSubmitting] = useState(false);

  const openCreate = () => {
    setEditUser(null);
    setForm({ email: '', role: 'student', status: 'active' });
    setDialogOpen(true);
  };

  const openEdit = (user: any) => {
    setEditUser(user);
    setForm({ email: user.email, role: user.role, status: user.status });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    if (editUser) {
      await apiPut(`/api/admin/users/${editUser.user_id}`, form);
    } else {
      await apiPost('/api/admin/users', form);
    }
    setSubmitting(false);
    setDialogOpen(false);
    refetch();
  };

  const handleDelete = async () => {
    setSubmitting(true);
    await apiDelete(`/api/admin/users/${deleteId}`);
    setSubmitting(false);
    setDeleteOpen(false);
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'user_id', header: 'User ID' },
    { accessorKey: 'email', header: 'Email' },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => <Badge variant="secondary" className="capitalize">{row.getValue('role')}</Badge>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string;
        const variant = status === 'active' ? 'success' : status === 'suspended' ? 'destructive' : 'outline';
        return <Badge variant={variant as any} className="capitalize">{status}</Badge>;
      },
    },
    {
      accessorKey: '_created_at',
      header: 'Created',
      cell: ({ row }) => formatDate(row.getValue('_created_at')),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { setDeleteId(row.original.user_id); setDeleteOpen(true); }}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Users" description="Manage system users">
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add User</Button>
      </PageHeader>

      <DataTable columns={columns} data={users || []} searchKey="email" searchPlaceholder="Search by email..." />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editUser ? 'Edit User' : 'Add User'}</DialogTitle>
            <DialogDescription>{editUser ? 'Update user details.' : 'Create a new user account.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editUser} />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })} disabled={!!editUser}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="teacher">Teacher</SelectItem>
                  <SelectItem value="parent">Parent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editUser && (
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Deactivate User" description="This will set the user status to inactive." onConfirm={handleDelete} loading={submitting} />
    </div>
  );
}
