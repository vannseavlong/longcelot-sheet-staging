import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      userId: string;
      role: 'admin' | 'student' | 'teacher' | 'parent';
      actorSheetId: string;
    } & {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    userId?: string;
    role?: string;
    actorSheetId?: string;
  }
}

export type Role = 'admin' | 'student' | 'teacher' | 'parent';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
}
