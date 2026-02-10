import {
  LayoutDashboard,
  Users,
  BookOpen,
  Link2,
  UserPlus,
  User,
  CalendarCheck,
  Clock,
  FileText,
  GraduationCap,
  Bell,
  FolderOpen,
  ClipboardList,
  MessageSquare,
  Baby,
  BarChart3,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from './types';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const navigationConfig: Record<Role, NavItem[]> = {
  admin: [
    { title: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { title: 'Users', href: '/admin/users', icon: Users },
    { title: 'Classes', href: '/admin/classes', icon: BookOpen },
    { title: 'Student-Teacher Map', href: '/admin/student-teacher-map', icon: Link2 },
    { title: 'Parent-Student Map', href: '/admin/parent-student-map', icon: UserPlus },
  ],
  student: [
    { title: 'Dashboard', href: '/student', icon: LayoutDashboard },
    { title: 'Profile', href: '/student/profile', icon: User },
    { title: 'Attendance', href: '/student/attendance', icon: CalendarCheck },
    { title: 'Timetable', href: '/student/timetable', icon: Clock },
    { title: 'Assignments', href: '/student/assignments', icon: FileText },
    { title: 'Grades', href: '/student/grades', icon: GraduationCap },
    { title: 'Notices', href: '/student/notices', icon: Bell },
  ],
  teacher: [
    { title: 'Dashboard', href: '/teacher', icon: LayoutDashboard },
    { title: 'Profile', href: '/teacher/profile', icon: User },
    { title: 'Materials', href: '/teacher/materials', icon: FolderOpen },
    { title: 'Assignments', href: '/teacher/assignments', icon: ClipboardList },
    { title: 'Feedback', href: '/teacher/feedback', icon: MessageSquare },
  ],
  parent: [
    { title: 'Dashboard', href: '/parent', icon: LayoutDashboard },
    { title: 'Children', href: '/parent/children', icon: Baby },
    { title: 'Attendance', href: '/parent/attendance', icon: CalendarCheck },
    { title: 'Grades', href: '/parent/grades', icon: BarChart3 },
  ],
};
