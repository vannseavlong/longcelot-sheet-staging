import { createSheetAdapter, createOAuthManager, hashPassword } from '../../src';
import usersSchema from './schemas/admin/users';
import credentialsSchema from './schemas/admin/credentials';
import studentProfileSchema from './schemas/student/profile';
import studentAttendanceSchema from './schemas/student/attendance';
import studentGradesSchema from './schemas/student/grades';

async function exampleUsage() {
  const adapter = createSheetAdapter({
    adminSheetId: process.env.ADMIN_SHEET_ID!,
    credentials: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    },
    tokens: {},
  });

  adapter.registerSchemas([
    usersSchema,
    credentialsSchema,
    studentProfileSchema,
    studentAttendanceSchema,
    studentGradesSchema,
  ]);

  console.log('=== Example 1: Admin creates a new student ===');
  const studentId = 'stu_' + Date.now();
  const studentEmail = 'john.doe@school.com';

  const studentSheetId = await adapter.createUserSheet(
    studentId,
    'student',
    studentEmail
  );

  console.log(`Student sheet created: ${studentSheetId}`);

  const adminContext = adapter.withContext({
    userId: 'admin_1',
    role: 'admin',
  });

  const passwordHash = await hashPassword('SecurePass123!');
  await adminContext.table('credentials').create({
    user_id: studentId,
    password_hash: passwordHash,
    provider: 'local',
  });

  console.log('Student credentials stored');

  console.log('\n=== Example 2: Student updates their profile ===');
  const studentContext = adapter.withContext({
    userId: studentId,
    role: 'student',
    actorSheetId: studentSheetId,
  });

  await studentContext.table('profile').create({
    student_id: studentId,
    name: 'John Doe',
    grade: '10',
    class_id: 'class_10a',
    date_of_birth: '2008-05-15',
    contact_number: '+1234567890',
  });

  console.log('Student profile created');

  console.log('\n=== Example 3: Teacher marks attendance ===');
  await studentContext.table('attendance').create({
    date: new Date().toISOString(),
    status: 'present',
    remark: 'On time',
    marked_by: 'teacher_1',
  });

  console.log('Attendance marked');

  console.log('\n=== Example 4: Teacher adds grades ===');
  await studentContext.table('grades').create({
    subject: 'Mathematics',
    term: '1',
    score: 85,
    grade: 'A',
    teacher_comment: 'Excellent work!',
    teacher_id: 'teacher_1',
  });

  console.log('Grade added');

  console.log('\n=== Example 5: Student queries their grades ===');
  const grades = await studentContext.table('grades').findMany({
    where: { term: '1' },
    orderBy: 'score',
    order: 'desc',
  });

  console.log('Grades:', grades);

  console.log('\n=== Example 6: Update grade ===');
  await studentContext.table('grades').update({
    where: { subject: 'Mathematics', term: '1' },
    data: { score: 90, grade: 'A+' },
  });

  console.log('Grade updated');

  console.log('\n=== Example 7: Query with filters ===');
  const presentDays = await studentContext.table('attendance').findMany({
    where: { status: 'present' },
  });

  console.log(`Present days: ${presentDays.length}`);

  console.log('\n=== Example 8: Admin queries all users ===');
  const allUsers = await adminContext.table('users').findMany({
    where: { status: 'active' },
    limit: 10,
  });

  console.log(`Active users: ${allUsers.length}`);

  console.log('\n✅ All examples completed successfully!');
}

if (require.main === module) {
  exampleUsage().catch(console.error);
}

export default exampleUsage;
