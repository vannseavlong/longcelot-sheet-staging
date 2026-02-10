import { InboxIcon } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
}

export function EmptyState({ title = 'No data', description = 'No records found.' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <InboxIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
