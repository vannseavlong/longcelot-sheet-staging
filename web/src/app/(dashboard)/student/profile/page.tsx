'use client';

import { useState, useEffect } from 'react';
import { useApi, apiPut } from '@/hooks/use-api';
import { PageHeader } from '@/components/shared/page-header';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil, Save, X } from 'lucide-react';

export default function StudentProfilePage() {
  const { data: profile, loading, refetch } = useApi<any>('/api/student/profile');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  const handleSave = async () => {
    setSubmitting(true);
    const { _id, _created_at, _updated_at, student_id, ...data } = form;
    await apiPut('/api/student/profile', data);
    setSubmitting(false);
    setEditing(false);
    refetch();
  };

  if (loading) return <TableSkeleton cols={2} rows={6} />;

  const fields = [
    { key: 'name', label: 'Full Name' },
    { key: 'grade', label: 'Grade' },
    { key: 'class_id', label: 'Class ID', readonly: true },
    { key: 'date_of_birth', label: 'Date of Birth' },
    { key: 'contact_number', label: 'Contact Number' },
    { key: 'photo_url', label: 'Photo URL' },
  ];

  return (
    <div>
      <PageHeader title="My Profile" description="View and edit your profile information">
        {!editing ? (
          <Button onClick={() => setEditing(true)}><Pencil className="mr-2 h-4 w-4" />Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(false); setForm(profile); }}><X className="mr-2 h-4 w-4" />Cancel</Button>
            <Button onClick={handleSave} disabled={submitting}><Save className="mr-2 h-4 w-4" />{submitting ? 'Saving...' : 'Save'}</Button>
          </div>
        )}
      </PageHeader>

      <Card>
        <CardHeader><CardTitle>Profile Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map(({ key, label, readonly }) => (
              <div key={key}>
                <Label className="text-muted-foreground">{label}</Label>
                {editing && !readonly ? (
                  <Input value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                ) : (
                  <p className="text-sm font-medium mt-1">{form[key] || '-'}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
