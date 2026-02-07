import { defineTable, string, date } from '../../../../src';

export default defineTable({
  name: 'attendance',
  actor: 'student',
  timestamps: true,
  columns: {
    date: date().required(),
    status: string().enum(['present', 'absent', 'late', 'excused']).required(),
    remark: string(),
    marked_by: string().ref('users.user_id'),
  },
});
