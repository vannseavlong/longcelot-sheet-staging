import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'parent_student_map',
  actor: 'admin',
  columns: {
    parent_id: string().required().ref('users.user_id'),
    student_id: string().required().ref('users.user_id'),
    relationship: string().required().enum(['father', 'mother', 'guardian']),
  },
});
