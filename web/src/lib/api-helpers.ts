import { NextRequest, NextResponse } from 'next/server';
import { auth } from './auth';
import { getAdapterForUser } from './db';
import type { Role, ApiResponse } from './types';
import type { SheetAdapter } from 'longcelot-sheet-db';

export async function withAuth(
  req: NextRequest,
  allowedRoles: Role[],
  handler: (
    req: NextRequest,
    adapter: SheetAdapter,
    session: { user: { userId: string; role: string; actorSheetId: string; email?: string | null } },
  ) => Promise<NextResponse>
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' } satisfies ApiResponse,
      { status: 401 }
    );
  }

  if (!allowedRoles.includes(session.user.role as Role)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' } satisfies ApiResponse,
      { status: 403 }
    );
  }

  const adapter = getAdapterForUser({
    userId: session.user.userId,
    role: session.user.role,
    actorSheetId: session.user.actorSheetId,
  });

  try {
    return await handler(req, adapter, session as any);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: message } satisfies ApiResponse,
      { status: 500 }
    );
  }
}

export function jsonResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data } satisfies ApiResponse<T>, { status });
}

export function errorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: message } satisfies ApiResponse, { status });
}
