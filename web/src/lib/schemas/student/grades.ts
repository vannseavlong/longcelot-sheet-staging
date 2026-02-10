import { defineTable, string, number } from 'longcelot-sheet-db';

export default defineTable({
  name: 'grades',
  actor: 'student',
  timestamps: true,
  columns: {
    subject: string().required(),
    term: string().required().enum(['1', '2', '3', 'final']),
    score: number().required().min(0).max(100),
    grade: string().enum(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']),
    teacher_comment: string(),
    teacher_id: string().ref('users.user_id'),
  },
});
