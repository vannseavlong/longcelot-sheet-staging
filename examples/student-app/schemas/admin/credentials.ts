import { defineTable, string } from '../../../../src';

export default defineTable({
  name: 'credentials',
  actor: 'admin',
  columns: {
    user_id: string().required().ref('users.user_id'),
    password_hash: string(),
    provider: string().enum(['oauth', 'local']).required(),
  },
});
