import { NextRequest } from 'next/server';
import { withAuth, jsonResponse, errorResponse } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const users = await adapter.table('users').findMany({
      orderBy: '_created_at',
      order: 'desc',
    });
    return jsonResponse(users);
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, ['admin'], async (_req, adapter) => {
    const body = await req.json();
    const { email, role } = body;

    if (!email || !role) {
      return errorResponse('Email and role are required');
    }

    const userId = `${role}_${Date.now()}`;

    // Create user record
    const user = await adapter.table('users').create({
      user_id: userId,
      email,
      role,
      status: 'active',
    });

    // Create credentials record
    await adapter.table('credentials').create({
      user_id: userId,
      provider: 'oauth',
    });

    return jsonResponse(user, 201);
  });
}
