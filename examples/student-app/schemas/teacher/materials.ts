import { defineTable, string, date } from '../../../../src';

export default defineTable({
  name: 'materials',
  actor: 'teacher',
  timestamps: true,
  columns: {
    material_id: string().required().unique(),
    subject: string().required(),
    title: string().required(),
    description: string(),
    file_url: string().required(),
    uploaded_at: date().required(),
  },
});
