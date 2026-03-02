-- Migration 037: Performance indexes from D1 query audit (Mar 2026)
--
-- Adds missing indexes identified during scaling audit for 10K+ properties.
-- All use IF NOT EXISTS for safe re-runs.

-- Properties: STR composite for location-based lookups
CREATE INDEX IF NOT EXISTS idx_properties_str
  ON properties(section, township, range);

-- Operator deduction profiles: joint operator+county lookup
-- (covers operator-only queries via leftmost prefix)
CREATE INDEX IF NOT EXISTS idx_odp_operator_county
  ON operator_deduction_profiles(operator_number, county);

-- Deduction observations: historical range queries by month
CREATE INDEX IF NOT EXISTS idx_do_production_month
  ON deduction_observations(production_month);

-- PUNs: operator+county composite for operator-level aggregations
-- (covers operator-only queries via leftmost prefix)
CREATE INDEX IF NOT EXISTS idx_puns_operator_county
  ON puns(operator_name, county);

-- Client wells: dashboard filtered queries (user's active/inactive wells)
CREATE INDEX IF NOT EXISTS idx_client_wells_user_status
  ON client_wells(user_id, status);
