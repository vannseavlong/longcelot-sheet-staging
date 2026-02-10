import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import type { NextAuthConfig } from 'next-auth';
import { getAdapter } from './db';

const config: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user?.email) return false;

      try {
        const adapter = getAdapter().withContext({
          userId: 'system',
          role: 'admin',
        });

        const existingUser = await adapter.table('users').findOne({
          where: { email: user.email },
        });

        if (!existingUser) return false;
        if (existingUser.status === 'suspended' || existingUser.status === 'inactive') {
          return false;
        }

        return true;
      } catch {
        // If sheets aren't configured yet, allow login for initial setup
        return true;
      }
    },

    async jwt({ token, user }) {
      if (user?.email) {
        try {
          const adapter = getAdapter().withContext({
            userId: 'system',
            role: 'admin',
          });

          const dbUser = await adapter.table('users').findOne({
            where: { email: user.email },
          });

          if (dbUser) {
            token.userId = dbUser.user_id as string;
            token.role = dbUser.role as string;
            token.actorSheetId = dbUser.actor_sheet_id as string;
          }
        } catch {
          // Default to admin if sheets not configured
          token.role = 'admin';
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.userId = (token.userId as string) || '';
        session.user.role = (token.role as 'admin' | 'student' | 'teacher' | 'parent') || 'student';
        session.user.actorSheetId = (token.actorSheetId as string) || '';
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
