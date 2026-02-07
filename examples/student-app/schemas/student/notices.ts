import { defineTable, string, date } from '../../../../src';

export default defineTable({
  name: 'notices',
  actor: 'student',
  columns: {
    notice_id: string().required().unique(),
    title: string().required(),
    message: string().required(),
    published_at: date().required(),
    from_role: string().enum(['admin', 'teacher']).required(),
    from_id: string().ref('users.user_id'),
  },
});
