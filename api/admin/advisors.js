/**
 * GET  /api/admin/advisors — List all advisors with agreement status.
 * POST /api/admin/advisors — Create a new advisor.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 *
 * POST body:
 *   {
 *     name:                   string
 *     email:                  string
 *     address?:               string
 *     shares?:                number   — default 10000000
 *     per_share_price?:       number   — default 0.0001
 *     purchase_price?:        number   — default 1000
 *     vesting_months?:        number   — default 24
 *     cliff_months?:          number   — default 0
 *     hours_per_month?:       number   — default 5
 *     services?:              string
 *     exclusive?:             boolean  — default false
 *     governing_law?:         string   — default 'Delaware'
 *     dispute_resolution?:    string   — default 'Arbitration'
 *     arbitration_institution?: string
 *   }
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function isAuthorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export default async function handler(req) {
  if (!isAuthorized(req)) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (req.method === 'GET') return listAdvisors();
  if (req.method === 'POST') return createAdvisor(req);
  return json({ ok: false, error: 'Method not allowed' }, 405);
}

async function listAdvisors() {
  const rows = await sql`
    SELECT
      a.id, a.name, a.email, a.address, a.shares, a.per_share_price, a.purchase_price,
      a.vesting_months, a.cliff_months, a.hours_per_month, a.services, a.exclusive,
      a.governing_law, a.dispute_resolution, a.arbitration_institution,
      a.portal_token, a.active, a.created_at,
      aa.agreement_token, aa.status AS agreement_status, aa.signed_at
    FROM advisors a
    LEFT JOIN advisor_agreements aa ON aa.advisor_id = a.id
    ORDER BY a.created_at DESC
  `;
  return json({ ok: true, advisors: rows });
}

async function createAdvisor(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const {
    name, email, address,
    shares = 10000000,
    per_share_price = 0.0001,
    purchase_price = 1000,
    vesting_months = 24,
    cliff_months = 0,
    hours_per_month = 5,
    services = 'Expert advisory services in business development, partnerships, sales, compliance, strategy',
    exclusive = false,
    governing_law = 'Delaware',
    dispute_resolution = 'Arbitration',
    arbitration_institution = 'American Arbitration Association (AAA)',
  } = body;

  if (!name || !email) return json({ ok: false, error: 'name and email are required' }, 400);

  const portal_token = crypto.randomUUID();
  const agreement_token = crypto.randomUUID();

  const [advisor] = await sql`
    INSERT INTO advisors (
      name, email, address, shares, per_share_price, purchase_price,
      vesting_months, cliff_months, hours_per_month, services, exclusive,
      governing_law, dispute_resolution, arbitration_institution, portal_token
    ) VALUES (
      ${name}, ${email}, ${address ?? null}, ${Number(shares)}, ${Number(per_share_price)},
      ${Number(purchase_price)}, ${Number(vesting_months)}, ${Number(cliff_months)},
      ${Number(hours_per_month)}, ${services}, ${Boolean(exclusive)},
      ${governing_law}, ${dispute_resolution}, ${arbitration_institution}, ${portal_token}
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO advisor_agreements (advisor_id, agreement_token)
    VALUES (${advisor.id}, ${agreement_token})
  `;

  return json({
    ok: true,
    advisor_id: advisor.id,
    agreement_url: `https://malamalabs.com/advisor-agreement/?token=${agreement_token}`,
    portal_url: `https://malamalabs.com/advisor-portal/?token=${portal_token}`,
  }, 201);
}
