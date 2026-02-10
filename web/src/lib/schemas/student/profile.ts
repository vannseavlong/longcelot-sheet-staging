import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'profile',
  actor: 'student',
  timestamps: true,
  columns: {
    student_id: string().required().primary(),
    name: string().required(),
    grade: string().required(),
    class_id: string().ref('classes.class_id'),
    photo_url: string(),
    date_of_birth: string(),
    contact_number: string(),
  },
});
