import 'dotenv/config'
import { z } from 'zod'

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional().default(''),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  OTP_FIXED_CODE_ENABLED: bool,
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(8),
  STORAGE_DIR: z.string().default('./storage'),
  // S3-compatible object storage (Supabase Storage, Cloudflare R2, AWS S3, MinIO). Leave S3_BUCKET empty to use local disk.
  S3_BUCKET: z.string().optional().default(''),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: bool,
  LOG_LEVEL: z.string().default('info'),
})

export type Config = z.infer<typeof schema> & { corsOrigins: string[]; isProd: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${msg}`)
  }
  const c = parsed.data
  if (c.NODE_ENV === 'production') {
    if (c.OTP_FIXED_CODE_ENABLED) throw new Error('OTP_FIXED_CODE_ENABLED must be false in production')
    if (/change-me/.test(c.JWT_SECRET + c.JWT_REFRESH_SECRET + c.PAYMENT_WEBHOOK_SECRET))
      throw new Error('Placeholder secrets are not allowed in production')
  }
  if (c.S3_BUCKET && (!c.S3_ACCESS_KEY_ID || !c.S3_SECRET_ACCESS_KEY)) throw new Error('S3_BUCKET is set but S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is missing')
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProd: c.NODE_ENV === 'production',
  }
}

export const config = loadConfig()
