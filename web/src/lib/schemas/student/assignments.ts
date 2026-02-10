import { defineTable, string, date } from 'longcelot-sheet-db';

export default defineTable({
  name: 'assignments',
  actor: 'student',
  timestamps: true,
  columns: {
    assignment_id: string().required().unique(),
    subject: string().required(),
    title: string().required(),
    description: string(),
    due_date: date().required(),
    status: string().enum(['pending', 'submitted', 'graded']).default('pending'),
    submitted_at: date(),
    submission_url: string(),
  },
});
