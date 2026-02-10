import { defineTable, string, number } from 'longcelot-sheet-db';

export default defineTable({
  name: 'attendance_summary',
  actor: 'parent',
  timestamps: true,
  columns: {
    student_id: string().required().ref('users.user_id'),
    month: string().required(),
    present_days: number().default(0),
    absent_days: number().default(0),
    late_days: number().default(0),
  },
});
