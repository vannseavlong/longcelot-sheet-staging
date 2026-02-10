import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'student_teacher_map',
  actor: 'admin',
  columns: {
    student_id: string().required().ref('users.user_id'),
    teacher_id: string().required().ref('users.user_id'),
    subject: string().required(),
  },
});
