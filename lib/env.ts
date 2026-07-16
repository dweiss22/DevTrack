import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  WRIKE_CLIENT_ID: z.string().min(1).optional(),
  WRIKE_CLIENT_SECRET: z.string().min(1).optional(),
  WRIKE_OAUTH_BASE_URL: z.string().url().default("https://login.wrike.com"),
  WRIKE_API_BASE_URL: z.string().url().default("https://www.wrike.com/api/v4"),
  TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(24).optional()
});

type Environment = z.infer<typeof schema>;
function readEnvironment(): Environment {
  return schema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    WRIKE_CLIENT_ID: process.env.WRIKE_CLIENT_ID,
    WRIKE_CLIENT_SECRET: process.env.WRIKE_CLIENT_SECRET,
    WRIKE_OAUTH_BASE_URL: process.env.WRIKE_OAUTH_BASE_URL,
    WRIKE_API_BASE_URL: process.env.WRIKE_API_BASE_URL,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    CRON_SECRET: process.env.CRON_SECRET
  });
}

// Defer validation until a route needs configuration so `next build` can run without deployment secrets.
export const env = new Proxy({} as Environment, { get: (_target, property) => readEnvironment()[property as keyof Environment] });
