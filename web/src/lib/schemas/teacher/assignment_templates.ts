import { defineTable, string, date } from 'longcelot-sheet-db';

export default defineTable({
  name: 'assignment_templates',
  actor: 'teacher',
  timestamps: true,
  columns: {
    assignment_id: string().required().unique(),
    subject: string().required(),
    title: string().required(),
    description: string(),
    due_date: date().required(),
    max_score: string(),
  },
});
