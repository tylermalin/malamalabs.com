// FAST v2 equity matrix + service tiers. Single source of truth shared by the
// admin create form, the agreement renderer, and server-side validation.

export const STAGES = ['idea', 'startup', 'growth'];
export const LEVELS = ['standard', 'strategic', 'expert'];

export const STAGE_LABEL = { idea: 'Idea', startup: 'Startup', growth: 'Growth' };
export const LEVEL_LABEL = { standard: 'Standard', strategic: 'Strategic', expert: 'Expert' };

// Advisor equity % of fully-diluted, by [level][stage] — from FAST v2.
export const EQUITY = {
  standard:  { idea: 0.25, startup: 0.20, growth: 0.15 },
  strategic: { idea: 0.50, startup: 0.40, growth: 0.30 },
  expert:    { idea: 1.00, startup: 0.80, growth: 0.60 },
};

export const HOURS = { standard: 5, strategic: 10, expert: 20 };

// Returns the FAST equity % for a level/stage, or null if invalid.
export function equityPct(level, stage) {
  const row = EQUITY[level];
  if (!row || !(stage in row)) return null;
  return row[stage];
}

export const VESTING = 'Monthly over 2 years, 3-month cliff; 100% accelerates on sale of the Company.';
