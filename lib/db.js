// Neon HTTP client — works in Vercel Edge Runtime without WebSockets.
// Import `sql` and use as a tagged template: sql`SELECT * FROM table WHERE id = ${id}`
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);
