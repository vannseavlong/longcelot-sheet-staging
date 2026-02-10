import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'profile',
  actor: 'teacher',
  timestamps: true,
  columns: {
    teacher_id: string().required().primary(),
    name: string().required(),
    subject: string().required(),
    email: string().required(),
    phone: string(),
    qualification: string(),
  },
});
