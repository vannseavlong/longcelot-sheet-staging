import { defineTable, string, number, date } from 'longcelot-sheet-db';

export default defineTable({
  name: 'feedback',
  actor: 'teacher',
  timestamps: true,
  columns: {
    student_id: string().required().ref('users.user_id'),
    assignment_id: string().required(),
    comment: string(),
    score: number().min(0),
    graded_at: date(),
  },
});
