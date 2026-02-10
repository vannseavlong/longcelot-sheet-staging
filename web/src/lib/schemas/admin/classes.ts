import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'classes',
  actor: 'admin',
  timestamps: true,
  columns: {
    class_id: string().required().unique(),
    name: string().required(),
    grade: string().required(),
    homeroom_teacher: string().ref('users.user_id'),
    academic_year: string().required(),
  },
});
