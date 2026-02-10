import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'timetable',
  actor: 'student',
  columns: {
    day: string().required().enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    subject: string().required(),
    start_time: string().required(),
    end_time: string().required(),
    teacher_id: string().ref('users.user_id'),
    room: string(),
  },
});
