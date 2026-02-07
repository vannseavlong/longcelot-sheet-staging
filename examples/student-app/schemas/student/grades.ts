import { defineTable, string, number } from '../../../../src';

export default defineTable({
  name: 'grades',
  actor: 'student',
  timestamps: true,
  columns: {
    subject: string().required(),
    term: string().enum(['1', '2', '3', 'final']).required(),
    score: number().min(0).max(100).required(),
    grade: string().enum(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']),
    teacher_comment: string(),
    teacher_id: string().ref('users.user_id'),
  },
});
