import { defineTable, string } from '../../../../src';

export default defineTable({
  name: 'children',
  actor: 'parent',
  columns: {
    student_id: string().required().ref('users.user_id'),
    name: string().required(),
    grade: string().required(),
    class: string(),
    relationship: string().enum(['father', 'mother', 'guardian']),
  },
});
