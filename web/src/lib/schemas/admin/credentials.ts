import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'credentials',
  actor: 'admin',
  columns: {
    user_id: string().required().ref('users.user_id'),
    password_hash: string(),
    provider: string().required().enum(['oauth', 'local']),
  },
});
