import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'users',
  actor: 'admin',
  timestamps: true,
  columns: {
    user_id: string().required().unique(),
    role: string().required().enum(['admin', 'student', 'teacher', 'parent']),
    email: string().required().unique(),
    actor_sheet_id: string(),
    status: string().enum(['active', 'inactive', 'suspended']).default('active'),
  },
});
