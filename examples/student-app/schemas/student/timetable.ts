import { defineTable, string } from '../../../../src';

export default defineTable({
  name: 'timetable',
  actor: 'student',
  columns: {
    day: string().enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']).required(),
    subject: string().required(),
    start_time: string().required(),
    end_time: string().required(),
    teacher_id: string().ref('users.user_id'),
    room: string(),
  },
});
