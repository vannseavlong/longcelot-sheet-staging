import { defineTable, string } from '../../../../src';

export default defineTable({
  name: 'parent_student_map',
  actor: 'admin',
  columns: {
    parent_id: string().required().ref('users.user_id'),
    student_id: string().required().ref('users.user_id'),
    relationship: string().enum(['father', 'mother', 'guardian']).required(),
  },
});
