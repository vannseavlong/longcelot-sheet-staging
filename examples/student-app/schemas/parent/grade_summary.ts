import { defineTable, string, number } from '../../../../src';

export default defineTable({
  name: 'grade_summary',
  actor: 'parent',
  timestamps: true,
  columns: {
    student_id: string().required().ref('users.user_id'),
    term: string().enum(['1', '2', '3', 'final']).required(),
    gpa: number().min(0).max(4.0),
    rank: string(),
    total_subjects: number(),
  },
});
