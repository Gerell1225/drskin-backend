import { z } from "zod";
const Env = z.object({
    PORT: z.string().default("8080"),
    APP_URL: z.string().url(),
    ALLOWED_ORIGINS: z.string().default(""),
    QPAY_BASE_URL: z.string().url(),
    QPAY_USERNAME: z.string(),
    QPAY_PASSWORD: z.string(),
    QPAY_INVOICE_CODE: z.string(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string()
});
export const env = Env.parse(globalThis.process?.env ?? {});
export const ALLOWED = env.ALLOWED_ORIGINS
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
//# sourceMappingURL=env.js.map