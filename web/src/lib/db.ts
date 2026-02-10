import { createSheetAdapter, SheetAdapter } from 'longcelot-sheet-db';
import { allSchemas } from './schemas';

let adapter: SheetAdapter | null = null;

export function getAdapter(): SheetAdapter {
  if (!adapter) {
    adapter = createSheetAdapter({
      adminSheetId: process.env.ADMIN_SHEET_ID!,
      credentials: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback/google',
      },
      tokens: {
        access_token: process.env.GOOGLE_SHEETS_ACCESS_TOKEN,
        refresh_token: process.env.GOOGLE_SHEETS_REFRESH_TOKEN,
        token_type: 'Bearer',
      },
    });
    adapter.registerSchemas(allSchemas);
  }
  return adapter;
}

export function getAdapterForUser(user: {
  userId: string;
  role: string;
  actorSheetId?: string;
}): SheetAdapter {
  return getAdapter().withContext({
    userId: user.userId,
    role: user.role,
    actorSheetId: user.actorSheetId,
  });
}
