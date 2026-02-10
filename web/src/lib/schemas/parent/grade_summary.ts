import { defineTable, string, number } from 'longcelot-sheet-db';

export default defineTable({
  name: 'grade_summary',
  actor: 'parent',
  timestamps: true,
  columns: {
    student_id: string().required().ref('users.user_id'),
    term: string().required().enum(['1', '2', '3', 'final']),
    gpa: number().min(0).max(4.0),
    rank: string(),
    total_subjects: number(),
  },
});
