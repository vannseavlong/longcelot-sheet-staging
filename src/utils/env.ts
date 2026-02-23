// src/utils/env.ts
import { z } from 'zod';

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  ADMIN_SHEET_ID: z.string(),
  // ...
});

export const validateEnv = () => envSchema.parse(process.env);