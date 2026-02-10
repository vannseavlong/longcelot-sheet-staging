import usersSchema from './admin/users';
import credentialsSchema from './admin/credentials';
import classesSchema from './admin/classes';
import studentTeacherMapSchema from './admin/student_teacher_map';
import parentStudentMapSchema from './admin/parent_student_map';
import studentProfileSchema from './student/profile';
import studentAttendanceSchema from './student/attendance';
import studentTimetableSchema from './student/timetable';
import studentAssignmentsSchema from './student/assignments';
import studentGradesSchema from './student/grades';
import studentNoticesSchema from './student/notices';
import teacherProfileSchema from './teacher/profile';
import teacherAssignmentTemplatesSchema from './teacher/assignment_templates';
import teacherFeedbackSchema from './teacher/feedback';
import teacherMaterialsSchema from './teacher/materials';
import parentChildrenSchema from './parent/children';
import parentAttendanceSummarySchema from './parent/attendance_summary';
import parentGradeSummarySchema from './parent/grade_summary';

export const allSchemas = [
  usersSchema,
  credentialsSchema,
  classesSchema,
  studentTeacherMapSchema,
  parentStudentMapSchema,
  studentProfileSchema,
  studentAttendanceSchema,
  studentTimetableSchema,
  studentAssignmentsSchema,
  studentGradesSchema,
  studentNoticesSchema,
  teacherProfileSchema,
  teacherAssignmentTemplatesSchema,
  teacherFeedbackSchema,
  teacherMaterialsSchema,
  parentChildrenSchema,
  parentAttendanceSummarySchema,
  parentGradeSummarySchema,
];

export {
  usersSchema,
  credentialsSchema,
  classesSchema,
  studentTeacherMapSchema,
  parentStudentMapSchema,
  studentProfileSchema,
  studentAttendanceSchema,
  studentTimetableSchema,
  studentAssignmentsSchema,
  studentGradesSchema,
  studentNoticesSchema,
  teacherProfileSchema,
  teacherAssignmentTemplatesSchema,
  teacherFeedbackSchema,
  teacherMaterialsSchema,
  parentChildrenSchema,
  parentAttendanceSummarySchema,
  parentGradeSummarySchema,
};
