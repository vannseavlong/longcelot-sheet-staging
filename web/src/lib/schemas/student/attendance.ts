import { defineTable, string, date } from 'longcelot-sheet-db';

export default defineTable({
  name: 'attendance',
  actor: 'student',
  timestamps: true,
  columns: {
    date: date().required(),
    status: string().required().enum(['present', 'absent', 'late', 'excused']),
    remark: string(),
    marked_by: string().ref('users.user_id'),
  },
});
