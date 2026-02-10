'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useApi, apiPut } from '@/hooks/use-api';
import { DataTable } from '@/components/shared/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Send } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const statusVariant: Record<string, string> = { pending: 'warning', submitted: 'success', graded: 'default' };

export default function AssignmentsPage() {
  const { data: assignments, loading, refetch } = useApi<any[]>('/api/student/assignments');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitId, setSubmitId] = useState('');
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    await apiPut('/api/student/assignments', { assignment_id: submitId, submission_url: submissionUrl });
    setSubmitting(false);
    setSubmitOpen(false);
    setSubmissionUrl('');
    refetch();
  };

  const columns: ColumnDef<any>[] = [
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'subject', header: 'Subject' },
    { accessorKey: 'due_date', header: 'Due Date', cell: ({ row }) => formatDate(row.getValue('due_date')) },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string;
        return <Badge variant={(statusVariant[status] || 'outline') as any} className="capitalize">{status}</Badge>;
      },
    },
    { accessorKey: 'submitted_at', header: 'Submitted', cell: ({ row }) => formatDate(row.getValue('submitted_at')) },
    {
      id: 'actions',
      cell: ({ row }) => {
        if (row.original.status === 'pending') {
          return (
            <Button size="sm" variant="outline" onClick={() => { setSubmitId(row.original.assignment_id); setSubmitOpen(true); }}>
              <Send className="mr-1 h-3 w-3" />Submit
            </Button>
          );
        }
        return null;
      },
    },
  ];

  if (loading) return <TableSkeleton />;

  return (
    <div>
      <PageHeader title="Assignments" description="View and submit your assignments" />
      <DataTable columns={columns} data={assignments || []} searchKey="subject" searchPlaceholder="Search by subject..." />

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Assignment</DialogTitle>
            <DialogDescription>Provide a URL to your submission.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Submission URL</Label>
            <Input value={submissionUrl} onChange={(e) => setSubmissionUrl(e.target.value)} placeholder="https://..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
