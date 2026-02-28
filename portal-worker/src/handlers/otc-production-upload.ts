import { Env } from "../types/env";
import { jsonResponse } from "../utils/responses";
import { normalizeBasePun } from "../utils/normalize.js";
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';

/**
 * Purge all production-related KV cache keys after OTC data changes.
 * Clears prod:*, decimal:*, and long-TTL intelligence caches so users
 * see fresh data immediately instead of waiting up to 24h for TTL expiry.
 */
async function purgeProductionCaches(env: Env): Promise<number> {
  if (!env.OCC_CACHE) return 0;

  let deleted = 0;

  // Purge prod:* and decimal:* caches (per-well production summaries)
  for (const prefix of ['prod:', 'decimal:']) {
    let cursor: string | undefined;
    do {
      const listed = await env.OCC_CACHE.list({ prefix, cursor, limit: 1000 });
      if (listed.keys.length > 0) {
        await Promise.all(listed.keys.map((k: any) => env.OCC_CACHE!.delete(k.name)));
        deleted += listed.keys.length;
      }
      cursor = listed.list_complete ? undefined : (listed as any).cursor;
    } while (cursor);
  }

  // Purge long-TTL intelligence caches that depend on OTC production data
  const intelligenceKeys = [
    'production-decline-markets', 'shut-in-markets',
    'shut-in-research', 'decline-research',
  ];
  for (const key of intelligenceKeys) {
    try {
      // These use prefix patterns like "production-decline-markets:user123"
      let cursor: string | undefined;
      do {
        const listed = await env.OCC_CACHE.list({ prefix: `${key}:`, cursor, limit: 1000 });
        if (listed.keys.length > 0) {
          await Promise.all(listed.keys.map((k: any) => env.OCC_CACHE!.delete(k.name)));
          deleted += listed.keys.length;
        }
        cursor = listed.list_complete ? undefined : (listed as any).cursor;
      } while (cursor);
    } catch {
      // Best effort — don't fail the pipeline for cache cleanup
    }
  }

  console.log(`[OTC] Purged ${deleted} production cache keys`);
  return deleted;
}

interface ProductionRecord {
  county_number: number;
  product_code: number;
  year_month: string;
  gross_volume: number;
  record_count: number;
}

interface UploadRequest {
  records: ProductionRecord[];
}

interface PunProductionRecord {
  pun: string;
  year_month: string;
  product_code: string;
  gross_volume: number;
  gross_value?: number;
}

interface PunUploadRequest {
  records: PunProductionRecord[];
  mode?: 'replace' | 'add';  // 'replace' = overwrite, 'add' = increment (for streaming)
}

/**
 * Handle POST /api/otc-sync/upload-production
 * Uploads processed production data to D1 county_production_monthly table
 *
 * D1 Schema:
 * - county_number: INTEGER
 * - product_code: INTEGER (1=Oil, 5=Gas)
 * - year_month: TEXT (YYYY-MM)
 * - gross_volume: REAL
 * - gross_value: REAL (we set to 0)
 * - record_count: INTEGER
 */
export async function handleUploadProductionData(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as UploadRequest;

    if (!body.records || !Array.isArray(body.records)) {
      return jsonResponse({ error: "Missing or invalid 'records' array" }, 400);
    }

    if (body.records.length === 0) {
      return jsonResponse({ message: "No records to upload", inserted: 0 }, 200);
    }

    // Validate records
    for (const record of body.records) {
      if (
        typeof record.county_number !== "number" ||
        typeof record.product_code !== "number" ||
        typeof record.year_month !== "string" ||
        typeof record.gross_volume !== "number"
      ) {
        return jsonResponse(
          {
            error: "Invalid record format",
            expected: {
              county_number: "number",
              product_code: "number (1=Oil, 5=Gas)",
              year_month: "string (YYYY-MM)",
              gross_volume: "number",
              record_count: "number",
            },
          },
          400
        );
      }
    }

    // Process in batches of 500 (D1 max batch size)
    const BATCH_SIZE = 500;
    let totalInserted = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);

      // Use INSERT OR REPLACE to handle upserts
      // Note: This requires a unique constraint on (county_number, product_code, year_month)
      const statements = batch.map((record) => {
        return env.WELLS_DB!.prepare(
          `INSERT OR REPLACE INTO county_production_monthly
           (county_number, product_code, year_month, gross_volume, gross_value, record_count)
           VALUES (?, ?, ?, ?, 0, ?)`
        ).bind(
          record.county_number,
          record.product_code,
          record.year_month,
          record.gross_volume,
          record.record_count || 0
        );
      });

      // Execute batch
      const results = await env.WELLS_DB!.batch(statements);

      for (const result of results) {
        if (result.meta.changes > 0) {
          totalInserted += result.meta.changes;
        }
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} records`,
      inserted: totalInserted,
      batches: Math.ceil(body.records.length / BATCH_SIZE),
    });
  } catch (error) {
    console.error("Error uploading production data:", error);
    return jsonResponse(
      {
        error: "Failed to upload production data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle GET /api/otc-sync/production-stats
 * Returns statistics about production data in D1
 */
export async function handleGetProductionStats(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Get overall stats
    const statsResult = await env.WELLS_DB!.prepare(
      `SELECT
         COUNT(*) as total_records,
         COUNT(DISTINCT county_number) as county_count,
         MIN(year_month) as earliest_month,
         MAX(year_month) as latest_month,
         SUM(CASE WHEN product_code = 1 THEN gross_volume ELSE 0 END) as total_oil,
         SUM(CASE WHEN product_code = 5 THEN gross_volume ELSE 0 END) as total_gas
       FROM county_production_monthly`
    ).first();

    // Get record count by product
    const byProductResult = await env.WELLS_DB!.prepare(
      `SELECT product_code, COUNT(*) as count, SUM(gross_volume) as volume
       FROM county_production_monthly
       GROUP BY product_code`
    ).all();

    // Get latest month's data summary
    const latestMonthResult = await env.WELLS_DB!.prepare(
      `SELECT year_month, COUNT(*) as records,
         SUM(CASE WHEN product_code = 1 THEN gross_volume ELSE 0 END) as oil_volume,
         SUM(CASE WHEN product_code = 5 THEN gross_volume ELSE 0 END) as gas_volume
       FROM county_production_monthly
       WHERE year_month = (SELECT MAX(year_month) FROM county_production_monthly)
       GROUP BY year_month`
    ).first();

    return jsonResponse({
      overall: statsResult,
      byProduct: byProductResult.results,
      latestMonth: latestMonthResult,
    });
  } catch (error) {
    console.error("Error getting production stats:", error);
    return jsonResponse(
      {
        error: "Failed to get production stats",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle POST /api/otc-sync/upload-pun-production
 * Uploads PUN-level production data to D1 otc_production table
 *
 * D1 Schema (otc_production):
 * - pun: TEXT (XXX-XXXXXX-X-XXXX)
 * - year_month: TEXT (YYYYMM)
 * - product_code: TEXT (1=Oil, 3=Condensate, 5=CasingheadGas, 6=NaturalGas)
 * - gross_volume: REAL
 * - gross_value: REAL
 */
export async function handleUploadPunProductionData(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as PunUploadRequest;

    if (!body.records || !Array.isArray(body.records)) {
      return jsonResponse({ error: "Missing or invalid 'records' array" }, 400);
    }

    if (body.records.length === 0) {
      return jsonResponse({ message: "No records to upload", inserted: 0 }, 200);
    }

    // Validate records
    for (const record of body.records) {
      if (
        typeof record.pun !== "string" ||
        typeof record.year_month !== "string" ||
        typeof record.product_code !== "string" ||
        typeof record.gross_volume !== "number"
      ) {
        return jsonResponse(
          {
            error: "Invalid record format",
            expected: {
              pun: "string (XXX-XXXXXX-X-XXXX)",
              year_month: "string (YYYYMM)",
              product_code: "string (1, 3, 5, or 6)",
              gross_volume: "number",
              gross_value: "number (optional)",
            },
          },
          400
        );
      }
    }

    // Process in batches of 500 (D1 max batch size)
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    const mode = body.mode || 'replace';

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);

      // Use INSERT with ON CONFLICT - either replace or add based on mode
      const statements = batch.map((record) => {
        if (mode === 'add') {
          // Add mode: increment existing values (for streaming uploads)
          return env.WELLS_DB!.prepare(
            `INSERT INTO otc_production (pun, year_month, product_code, gross_volume, gross_value, base_pun)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(pun, year_month, product_code) DO UPDATE SET
               gross_volume = gross_volume + excluded.gross_volume,
               gross_value = gross_value + excluded.gross_value,
               base_pun = excluded.base_pun`
          ).bind(
            record.pun,
            record.year_month,
            record.product_code,
            record.gross_volume,
            record.gross_value || 0,
            normalizeBasePun(record.pun)
          );
        } else {
          // Replace mode: overwrite existing values (default, for full reloads)
          return env.WELLS_DB!.prepare(
            `INSERT INTO otc_production (pun, year_month, product_code, gross_volume, gross_value, base_pun)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(pun, year_month, product_code) DO UPDATE SET
               gross_volume = excluded.gross_volume,
               gross_value = excluded.gross_value,
               base_pun = excluded.base_pun`
          ).bind(
            record.pun,
            record.year_month,
            record.product_code,
            record.gross_volume,
            record.gross_value || 0,
            normalizeBasePun(record.pun)
          );
        }
      });

      // Execute batch
      const results = await env.WELLS_DB!.batch(statements);

      for (const result of results) {
        if (result.meta.changes > 0) {
          totalInserted += result.meta.changes;
        }
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} PUN production records`,
      inserted: totalInserted,
      batches: Math.ceil(body.records.length / BATCH_SIZE),
    });
  } catch (error) {
    console.error("Error uploading PUN production data:", error);
    return jsonResponse(
      {
        error: "Failed to upload PUN production data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle POST /api/otc-sync/compute-pun-rollups
 * Recomputes aggregate fields on the puns table from otc_production data
 *
 * Updates:
 * - first_prod_month, last_prod_month
 * - total_oil_bbl, total_gas_mcf
 * - peak_month, peak_month_oil_bbl, peak_month_gas_mcf
 * - decline_rate_12m, months_since_production, is_stale
 */
export async function handleComputePunRollups(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const startTime = Date.now();

    // Parse optional county parameter for scoped processing
    // When county is provided (e.g., "043"), only process PUNs for that county
    // This avoids D1/Worker timeouts when processing all 185K+ PUNs at once
    let county: string | null = null;
    try {
      const body = (await request.json()) as { county?: string };
      county = body?.county || null;
    } catch {
      // No body or invalid JSON - process all PUNs
    }

    // Validate county format (3 digits)
    if (county && !/^\d{3}$/.test(county)) {
      return jsonResponse(
        { error: "Invalid county format. Must be 3 digits (e.g., '043')." },
        400
      );
    }

    const countyCondition = county ? "AND pun LIKE ?" : "";
    const countyBinding: string[] = county ? [`${county}-%`] : [];
    const logPrefix = county ? `[PunRollup:${county}]` : "[PunRollup]";

    // Helper to run a prepared statement with optional county binding appended
    const runQuery = async (sql: string, bindings: (string | number)[] = []) => {
      const allBindings = [...bindings, ...countyBinding];
      if (allBindings.length > 0) {
        return env.WELLS_DB!.prepare(sql).bind(...allBindings).run();
      }
      return env.WELLS_DB!.prepare(sql).run();
    };

    // Step 0: Seed any new PUNs from otc_production that don't exist in puns yet
    console.log(`${logPrefix} Step 0: Seeding new PUNs...`);
    const seedResult = await runQuery(`
      INSERT OR IGNORE INTO puns (pun, base_pun)
      SELECT DISTINCT pun, SUBSTR(pun, 1, 10)
      FROM otc_production
      WHERE pun NOT IN (SELECT pun FROM puns)
      ${countyCondition}
    `);
    const step0Seeded = seedResult.meta.changes;
    // Also backfill base_pun on any existing puns rows where it's NULL
    await runQuery(`
      UPDATE puns SET base_pun = SUBSTR(pun, 1, 10)
      WHERE base_pun IS NULL
      ${countyCondition}
    `);
    console.log(`${logPrefix} Step 0: Seeded ${step0Seeded} new PUNs`);

    // Step 1: Update first/last production months and totals
    console.log(`${logPrefix} Step 1: Updating first/last months and totals...`);
    const aggregateResult = await runQuery(`
      UPDATE puns SET
        first_prod_month = (
          SELECT MIN(year_month) FROM otc_production WHERE otc_production.pun = puns.pun
        ),
        last_prod_month = (
          SELECT MAX(year_month) FROM otc_production WHERE otc_production.pun = puns.pun
        ),
        total_oil_bbl = (
          SELECT COALESCE(SUM(gross_volume), 0) FROM otc_production
          WHERE otc_production.pun = puns.pun AND product_code IN ('1', '3')
        ),
        total_gas_mcf = (
          SELECT COALESCE(SUM(gross_volume), 0) FROM otc_production
          WHERE otc_production.pun = puns.pun AND product_code IN ('5', '6')
        )
      WHERE EXISTS (SELECT 1 FROM otc_production WHERE otc_production.pun = puns.pun)
      ${countyCondition}
    `);
    const step1Changes = aggregateResult.meta.changes;

    // Step 2: Update peak month (month with highest oil production)
    console.log(`${logPrefix} Step 2: Updating peak month...`);
    const peakResult = await runQuery(`
      UPDATE puns SET
        peak_month = (
          SELECT year_month FROM otc_production
          WHERE otc_production.pun = puns.pun AND product_code IN ('1', '3')
          GROUP BY year_month
          ORDER BY SUM(gross_volume) DESC
          LIMIT 1
        ),
        peak_month_oil_bbl = (
          SELECT SUM(gross_volume) FROM otc_production
          WHERE otc_production.pun = puns.pun AND product_code IN ('1', '3')
          GROUP BY year_month
          ORDER BY SUM(gross_volume) DESC
          LIMIT 1
        )
      WHERE EXISTS (SELECT 1 FROM otc_production WHERE otc_production.pun = puns.pun AND product_code IN ('1', '3'))
      ${countyCondition}
    `);
    const step2Changes = peakResult.meta.changes;

    // Find data horizon — latest month with substantial production data
    // This handles the lag between OTC data availability and today's date
    // Without this, wells producing in the latest available month appear "idle"
    // because months_since_production is measured from today, not the data edge
    console.log(`${logPrefix} Finding data horizon...`);
    const DATA_HORIZON_THRESHOLD = 10000;
    const horizonQuery = await env.WELLS_DB!.prepare(`
      SELECT last_prod_month, COUNT(*) as cnt
      FROM puns
      WHERE last_prod_month IS NOT NULL
      GROUP BY last_prod_month
      ORDER BY last_prod_month DESC
      LIMIT 12
    `).all();

    const horizonRows = horizonQuery.results as Array<{ last_prod_month: string; cnt: number }>;
    let referenceYearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
    for (const row of horizonRows) {
      if (row.cnt >= DATA_HORIZON_THRESHOLD) {
        referenceYearMonth = row.last_prod_month;
        break;
      }
    }
    console.log(`${logPrefix} Data horizon: ${referenceYearMonth} (top months: ${horizonRows.slice(0, 4).map(r => `${r.last_prod_month}=${r.cnt}`).join(', ')})`);

    // Helper to subtract months from a YYYYMM string
    function subtractMonths(ym: string, n: number): string {
      let y = parseInt(ym.substring(0, 4));
      let m = parseInt(ym.substring(4, 6)) - n;
      while (m <= 0) { m += 12; y -= 1; }
      return `${y}${String(m).padStart(2, '0')}`;
    }

    // Step 3: Update is_stale and months_since_production
    // Anchored to data horizon, not today
    console.log(`${logPrefix} Step 3: Updating staleness flags (ref: ${referenceYearMonth})...`);
    const sixMonthsAgo = subtractMonths(referenceYearMonth, 6);

    const staleResult = await runQuery(`
      UPDATE puns SET
        is_stale = CASE WHEN last_prod_month < ? THEN 1 ELSE 0 END,
        months_since_production = CASE
          WHEN last_prod_month IS NULL THEN NULL
          ELSE MAX(0,
            (CAST(SUBSTR(?, 1, 4) AS INTEGER) - CAST(SUBSTR(last_prod_month, 1, 4) AS INTEGER)) * 12 +
            (CAST(SUBSTR(?, 5, 2) AS INTEGER) - CAST(SUBSTR(last_prod_month, 5, 2) AS INTEGER))
          )
        END
      WHERE last_prod_month IS NOT NULL
      ${countyCondition}
    `, [sixMonthsAgo, referenceYearMonth, referenceYearMonth]);
    const step3Changes = staleResult.meta.changes;

    // Step 4: Compute decline rate (compare recent 3 months BOE to same period last year)
    // Uses BOE (Barrels of Oil Equivalent) across ALL product codes:
    //   Oil (1) + Condensate (6) = BBL as-is
    //   Gas (5) + Casinghead (3) = MCF / 6 to convert to BOE
    // Anchored to data horizon, not today
    console.log(`${logPrefix} Step 4: Updating decline rates (BOE-based)...`);
    const recentMonthEnd = referenceYearMonth;
    const recentMonthStart = subtractMonths(referenceYearMonth, 3);
    const yearAgoEnd = subtractMonths(referenceYearMonth, 12);
    const yearAgoStart = subtractMonths(referenceYearMonth, 15);

    const declineResult = await runQuery(`
      UPDATE puns SET
        decline_rate_12m = (
          SELECT
            CASE
              WHEN COALESCE(old_boe, 0) = 0 THEN NULL
              ELSE ROUND(((COALESCE(new_boe, 0) - old_boe) / old_boe) * 100, 2)
            END
          FROM (
            SELECT
              (SELECT SUM(CASE WHEN product_code IN ('1', '6') THEN gross_volume ELSE gross_volume / 6.0 END)
               FROM otc_production
               WHERE pun = puns.pun
               AND year_month >= ? AND year_month <= ?) as new_boe,
              (SELECT SUM(CASE WHEN product_code IN ('1', '6') THEN gross_volume ELSE gross_volume / 6.0 END)
               FROM otc_production
               WHERE pun = puns.pun
               AND year_month >= ? AND year_month <= ?) as old_boe
          )
        )
      WHERE EXISTS (SELECT 1 FROM otc_production WHERE pun = puns.pun)
      ${countyCondition}
    `, [recentMonthStart, recentMonthEnd, yearAgoStart, yearAgoEnd]);
    const step4Changes = declineResult.meta.changes;

    // Step 5: Propagate last_prod_month to wells table for efficient nearby-wells queries
    console.log(`${logPrefix} Step 5: Propagating last_prod_month to wells table...`);
    const wellsProdResult = await env.WELLS_DB!.prepare(`
      UPDATE wells SET last_prod_month = (
        SELECT MAX(p.last_prod_month)
        FROM well_pun_links wpl
        JOIN puns p ON wpl.base_pun = p.base_pun
        WHERE wpl.api_number = wells.api_number
        AND p.last_prod_month IS NOT NULL
      )
      WHERE api_number IN (
        SELECT DISTINCT wpl.api_number FROM well_pun_links wpl
        JOIN puns p ON wpl.base_pun = p.base_pun
        WHERE p.last_prod_month IS NOT NULL
        ${county ? "AND wpl.base_pun LIKE ?" : ""}
      )
    `).bind(...(county ? [`${county}%`] : [])).run();
    const step5Changes = wellsProdResult.meta.changes;
    console.log(`${logPrefix} Step 5: Updated ${step5Changes} wells with last_prod_month`);

    // Step 6: Update financial rollups from otc_production_financial
    console.log(`${logPrefix} Step 6: Updating financial rollups...`);
    let step6Changes = 0;
    try {
      const financialResult = await runQuery(`
        UPDATE puns SET
          total_gross_value = (
            SELECT COALESCE(SUM(gross_value), 0) FROM otc_production_financial
            WHERE otc_production_financial.pun = puns.pun
          ),
          total_net_value = (
            SELECT COALESCE(SUM(net_value), 0) FROM otc_production_financial
            WHERE otc_production_financial.pun = puns.pun
          )
        WHERE EXISTS (SELECT 1 FROM otc_production_financial WHERE otc_production_financial.pun = puns.pun)
        ${countyCondition}
      `);
      step6Changes = financialResult.meta.changes;
      console.log(`${logPrefix} Step 6: Updated financial rollups for ${step6Changes} PUNs`);
    } catch (financialErr) {
      console.error(`${logPrefix} Step 6: Financial rollup failed (non-fatal):`, financialErr);
    }

    // Purge stale production caches so users see fresh data
    let cachesPurged = 0;
    try {
      cachesPurged = await purgeProductionCaches(env);
    } catch (purgeErr) {
      console.error('[OTC] Cache purge failed (non-fatal):', purgeErr);
    }

    const duration = Date.now() - startTime;

    return jsonResponse({
      success: true,
      message: county
        ? `PUN rollups computed for county ${county}`
        : "PUN rollups computed successfully",
      county: county || "all",
      dataHorizon: referenceYearMonth,
      cachesPurged,
      stats: {
        step0_new_puns_seeded: step0Seeded,
        step1_aggregates: step1Changes,
        step2_peak_month: step2Changes,
        step3_staleness: step3Changes,
        step4_decline_rate: step4Changes,
        step5_wells_prod_month: step5Changes,
        step6_financial_rollups: step6Changes,
        duration_ms: duration,
      },
    });
  } catch (error) {
    console.error("Error computing PUN rollups:", error);
    return jsonResponse(
      {
        error: "Failed to compute PUN rollups",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle POST /api/otc-sync/truncate-pun-production
 * Truncates the otc_production table before a full reload
 * Uses batched deletes to avoid D1 timeout on large tables
 */
export async function handleTruncatePunProduction(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Get count before truncate
    const countBefore = await env.WELLS_DB!.prepare(
      `SELECT COUNT(*) as count FROM otc_production`
    ).first() as { count: number };

    const totalRecords = countBefore?.count || 0;
    if (totalRecords === 0) {
      return jsonResponse({
        success: true,
        message: "Table already empty",
        records_deleted: 0,
      });
    }

    // Delete in batches of 50K to avoid timeout
    // D1 can handle about 50K deletes per operation
    const BATCH_SIZE = 50000;
    let totalDeleted = 0;
    let iterations = 0;
    const maxIterations = Math.ceil(totalRecords / BATCH_SIZE) + 5; // Safety limit

    console.log(`[Truncate] Starting batched delete of ${totalRecords} records`);

    while (iterations < maxIterations) {
      iterations++;
      const result = await env.WELLS_DB!.prepare(
        `DELETE FROM otc_production WHERE rowid IN (SELECT rowid FROM otc_production LIMIT ?)`
      ).bind(BATCH_SIZE).run();

      const deleted = result.meta.changes || 0;
      totalDeleted += deleted;

      console.log(`[Truncate] Batch ${iterations}: deleted ${deleted}, total ${totalDeleted}`);

      if (deleted < BATCH_SIZE) {
        // Last batch - we're done
        break;
      }
    }

    // Purge stale production caches
    let cachesPurged = 0;
    try {
      cachesPurged = await purgeProductionCaches(env);
    } catch (purgeErr) {
      console.error('[OTC] Cache purge after truncate failed (non-fatal):', purgeErr);
    }

    return jsonResponse({
      success: true,
      message: `otc_production table truncated in ${iterations} batches`,
      records_deleted: totalDeleted,
      cachesPurged,
    });
  } catch (error) {
    console.error("Error truncating PUN production data:", error);
    return jsonResponse(
      {
        error: "Failed to truncate PUN production data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle GET /api/otc-sync/pun-production-stats
 * Returns statistics about PUN-level production data
 */
export async function handleGetPunProductionStats(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Get overall stats
    const statsResult = await env.WELLS_DB!.prepare(
      `SELECT
         COUNT(*) as total_records,
         COUNT(DISTINCT pun) as unique_puns,
         MIN(year_month) as earliest_month,
         MAX(year_month) as latest_month,
         SUM(CASE WHEN product_code IN ('1', '3') THEN gross_volume ELSE 0 END) as total_oil,
         SUM(CASE WHEN product_code IN ('5', '6') THEN gross_volume ELSE 0 END) as total_gas
       FROM otc_production`
    ).first();

    // Get record count by product
    const byProductResult = await env.WELLS_DB!.prepare(
      `SELECT product_code, COUNT(*) as count, SUM(gross_volume) as volume
       FROM otc_production
       GROUP BY product_code`
    ).all();

    // Get top PUNs by oil production
    const topPunsResult = await env.WELLS_DB!.prepare(
      `SELECT pun, SUM(gross_volume) as total_oil
       FROM otc_production
       WHERE product_code IN ('1', '3')
       GROUP BY pun
       ORDER BY total_oil DESC
       LIMIT 10`
    ).all();

    // Get puns table rollup stats
    const rollupStats = await env.WELLS_DB!.prepare(
      `SELECT
         COUNT(*) as total_puns,
         COUNT(CASE WHEN is_stale = 1 THEN 1 END) as stale_count,
         COUNT(CASE WHEN decline_rate_12m < 0 THEN 1 END) as declining_count,
         COUNT(CASE WHEN decline_rate_12m > 0 THEN 1 END) as growing_count,
         AVG(decline_rate_12m) as avg_decline_rate
       FROM puns
       WHERE last_prod_month IS NOT NULL`
    ).first();

    return jsonResponse({
      production: statsResult,
      byProduct: byProductResult.results,
      topPuns: topPunsResult.results,
      rollupStats: rollupStats,
    });
  } catch (error) {
    console.error("Error getting PUN production stats:", error);
    return jsonResponse(
      {
        error: "Failed to get PUN production stats",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * POST /api/otc-sync/validate-normalization
 *
 * Validates PUN and API number normalization across all OTC tables.
 * Intended to run after sync completes (called by Fly server.py).
 * Auto-fixes NULL base_puns; reports counts of any anomalies.
 */
export async function handleValidateNormalization(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const results: Record<string, any> = {};
    let totalFixed = 0;

    // 1. Fix NULL base_pun in puns table (~91K rows — fast)
    const fixPuns = await env.WELLS_DB!.prepare(`
      UPDATE puns SET base_pun = SUBSTR(pun, 1, 10)
      WHERE base_pun IS NULL
    `).run();
    results.puns_null_base_pun_fixed = fixPuns.meta.changes;
    totalFixed += fixPuns.meta.changes;

    // 2. Fix NULL base_pun in otc_leases (~85K rows — fast)
    const fixLeases = await env.WELLS_DB!.prepare(`
      UPDATE otc_leases SET base_pun = SUBSTR(pun, 1, 10)
      WHERE base_pun IS NULL
    `).run();
    results.otc_leases_null_base_pun_fixed = fixLeases.meta.changes;
    totalFixed += fixLeases.meta.changes;

    // 3. Fix NULL base_pun in otc_production — batched to avoid D1 CPU limit on 11M+ rows
    let prodFixed = 0;
    for (let i = 0; i < 10; i++) {
      const batch = await env.WELLS_DB!.prepare(`
        UPDATE otc_production SET base_pun = SUBSTR(pun, 1, 10)
        WHERE rowid IN (SELECT rowid FROM otc_production WHERE base_pun IS NULL LIMIT 25000)
      `).run();
      prodFixed += batch.meta.changes;
      if (batch.meta.changes === 0) break;
    }
    results.otc_production_null_base_pun_fixed = prodFixed;
    totalFixed += prodFixed;

    // 4. Check for malformed base_pun in well_pun_links (~small table)
    const badLinks = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt FROM well_pun_links
      WHERE base_pun IS NULL OR LENGTH(base_pun) != 10
    `).first<{ cnt: number }>();
    results.well_pun_links_malformed = badLinks?.cnt || 0;

    // 5. Sample check otc_production for malformed PUNs (avoid full 11M scan)
    const badProdSample = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT 1 FROM otc_production
        WHERE LENGTH(pun) < 15
        LIMIT 100
      )
    `).first<{ cnt: number }>();
    results.otc_production_short_pun_sample = badProdSample?.cnt || 0;

    // 6. Check API numbers in wells table (~175K rows — fast with index)
    const badApis = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt FROM wells
      WHERE api_number IS NOT NULL AND (LENGTH(api_number) != 10 OR api_number NOT LIKE '35%')
    `).first<{ cnt: number }>();
    results.wells_non_standard_api = badApis?.cnt || 0;

    // 7. Check client_wells API numbers (~small table)
    const badClientApis = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt FROM client_wells
      WHERE api_number IS NOT NULL AND api_number != '' AND (LENGTH(api_number) != 10 OR api_number NOT LIKE '35%')
    `).first<{ cnt: number }>();
    results.client_wells_non_standard_api = badClientApis?.cnt || 0;

    // Determine overall health
    const anomalies = (results.well_pun_links_malformed || 0)
      + (results.otc_production_short_pun_sample || 0)
      + (results.wells_non_standard_api || 0)
      + (results.client_wells_non_standard_api || 0);

    return jsonResponse({
      success: true,
      healthy: anomalies === 0,
      total_fixed: totalFixed,
      anomalies,
      details: results,
    });
  } catch (error) {
    console.error("Error validating normalization:", error);
    return jsonResponse(
      { error: "Validation failed", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

/**
 * Diagnostic: PUN crosswalk health report.
 * Read-only queries to surface migration opportunities, orphan PUNs, and drift.
 * POST /api/otc-sync/crosswalk-diagnostics
 */
export async function handleCrosswalkDiagnostics(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const diagnostics: Record<string, any> = {};

    // ── 1. Crosswalk migration preview ──
    // Records in pun_api_crosswalk that have NO corresponding entry in well_pun_links
    const orphanCrosswalk = await env.WELLS_DB!.prepare(`
      SELECT c.api_number, c.pun, c.confidence, c.match_source, c.pun_1002a
      FROM pun_api_crosswalk c
      LEFT JOIN well_pun_links wpl ON c.api_number = wpl.api_number AND c.pun = wpl.pun
      WHERE wpl.api_number IS NULL
      LIMIT 50
    `).all();
    const orphanCrosswalkCount = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt
      FROM pun_api_crosswalk c
      LEFT JOIN well_pun_links wpl ON c.api_number = wpl.api_number AND c.pun = wpl.pun
      WHERE wpl.api_number IS NULL
    `).first<{ cnt: number }>();

    diagnostics.crosswalk_migration = {
      description: "Records in pun_api_crosswalk with no matching well_pun_links entry — candidates for migration before deprecating the old table",
      total: orphanCrosswalkCount?.cnt || 0,
      sample: orphanCrosswalk.results,
    };

    // Also count total records in each table for context
    const crosswalkTotal = await env.WELLS_DB!.prepare(`SELECT COUNT(*) as cnt FROM pun_api_crosswalk`).first<{ cnt: number }>();
    const wplTotal = await env.WELLS_DB!.prepare(`SELECT COUNT(*) as cnt FROM well_pun_links`).first<{ cnt: number }>();
    diagnostics.table_sizes = {
      pun_api_crosswalk: crosswalkTotal?.cnt || 0,
      well_pun_links: wplTotal?.cnt || 0,
    };

    // ── 2. Orphan PUNs — production data with no well links ──
    // base_puns that have production but are NOT linked to any well
    const orphanPuns = await env.WELLS_DB!.prepare(`
      SELECT p.base_pun, p.pun, p.total_oil_bbl, p.total_gas_mcf, p.last_prod_month,
             l.lease_name, l.county, l.formation
      FROM puns p
      LEFT JOIN well_pun_links wpl ON p.base_pun = wpl.base_pun
      LEFT JOIN otc_leases l ON p.pun = l.pun
      WHERE wpl.base_pun IS NULL
        AND (p.total_oil_bbl > 0 OR p.total_gas_mcf > 0)
      ORDER BY (COALESCE(p.total_oil_bbl, 0) + COALESCE(p.total_gas_mcf, 0) / 6) DESC
      LIMIT 50
    `).all();
    const orphanPunsCount = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt
      FROM puns p
      LEFT JOIN well_pun_links wpl ON p.base_pun = wpl.base_pun
      WHERE wpl.base_pun IS NULL
        AND (p.total_oil_bbl > 0 OR p.total_gas_mcf > 0)
    `).first<{ cnt: number }>();

    // Count actively producing orphans
    const activeOrphanCount = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt
      FROM puns p
      LEFT JOIN well_pun_links wpl ON p.base_pun = wpl.base_pun
      WHERE wpl.base_pun IS NULL
        AND (p.total_oil_bbl > 0 OR p.total_gas_mcf > 0)
        AND p.is_stale = 0
    `).first<{ cnt: number }>();

    diagnostics.orphan_puns = {
      description: "PUNs with production data but no link to any tracked well — unmatched revenue potential",
      total: orphanPunsCount?.cnt || 0,
      actively_producing: activeOrphanCount?.cnt || 0,
      top_by_boe: orphanPuns.results,
    };

    // ── 3. wells.otc_prod_unit_no drift ──
    // Wells where denormalized column disagrees with well_pun_links
    const drift = await env.WELLS_DB!.prepare(`
      SELECT w.api_number, w.well_name, w.otc_prod_unit_no AS wells_pun,
             wpl.pun AS links_pun, wpl.match_method, wpl.confidence
      FROM wells w
      JOIN well_pun_links wpl ON w.api_number = wpl.api_number
      WHERE w.otc_prod_unit_no IS NOT NULL
        AND w.otc_prod_unit_no != ''
        AND SUBSTR(w.otc_prod_unit_no, 1, 10) != wpl.base_pun
      LIMIT 50
    `).all();
    const driftCount = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt
      FROM wells w
      JOIN well_pun_links wpl ON w.api_number = wpl.api_number
      WHERE w.otc_prod_unit_no IS NOT NULL
        AND w.otc_prod_unit_no != ''
        AND SUBSTR(w.otc_prod_unit_no, 1, 10) != wpl.base_pun
    `).first<{ cnt: number }>();

    // Wells with otc_prod_unit_no but NO well_pun_links entry
    const missingLinks = await env.WELLS_DB!.prepare(`
      SELECT w.api_number, w.well_name, w.otc_prod_unit_no
      FROM wells w
      LEFT JOIN well_pun_links wpl ON w.api_number = wpl.api_number
      WHERE w.otc_prod_unit_no IS NOT NULL
        AND w.otc_prod_unit_no != ''
        AND wpl.api_number IS NULL
      LIMIT 50
    `).all();
    const missingLinksCount = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as cnt
      FROM wells w
      LEFT JOIN well_pun_links wpl ON w.api_number = wpl.api_number
      WHERE w.otc_prod_unit_no IS NOT NULL
        AND w.otc_prod_unit_no != ''
        AND wpl.api_number IS NULL
    `).first<{ cnt: number }>();

    diagnostics.pun_drift = {
      description: "Wells where otc_prod_unit_no disagrees with well_pun_links base_pun",
      disagreements: {
        total: driftCount?.cnt || 0,
        sample: drift.results,
      },
      missing_links: {
        description: "Wells with otc_prod_unit_no set but NO well_pun_links entry — fallback is active, could be promoted to a proper link",
        total: missingLinksCount?.cnt || 0,
        sample: missingLinks.results,
      },
    };

    return jsonResponse({ success: true, diagnostics });
  } catch (error) {
    console.error("Error running crosswalk diagnostics:", error);
    return jsonResponse(
      { error: "Diagnostics failed", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

/**
 * Promote wells.otc_prod_unit_no → well_pun_links for wells that have a PUN
 * in the denormalized column but no proper link row.
 * Filters out junk values (N/A, too short, non-numeric).
 * Supports ?dry_run=true to preview without writing.
 *
 * POST /api/otc-sync/promote-pun-links
 * POST /api/otc-sync/promote-pun-links?dry_run=true
 */
export async function handlePromotePunLinks(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';

    // Find all wells with otc_prod_unit_no but no well_pun_links entry
    const candidates = await env.WELLS_DB!.prepare(`
      SELECT w.api_number, w.well_name, w.otc_prod_unit_no, w.county
      FROM wells w
      LEFT JOIN well_pun_links wpl ON w.api_number = wpl.api_number
      WHERE w.otc_prod_unit_no IS NOT NULL
        AND w.otc_prod_unit_no != ''
        AND wpl.api_number IS NULL
    `).all();

    const results = {
      dry_run: dryRun,
      total_candidates: candidates.results.length,
      promoted: 0,
      skipped_junk: [] as { api: string; well_name: string; raw_pun: string; reason: string }[],
      skipped_no_match: [] as { api: string; well_name: string; normalized_pun: string }[],
      promoted_list: [] as { api: string; well_name: string; pun: string; base_pun: string; verified_in_otc: boolean }[],
    };

    const JUNK_VALUES = ['N/A', 'NA', 'n/a', 'na', 'none', 'None', 'NONE', '', '-', '--', '0'];

    for (const row of candidates.results) {
      const r = row as any;
      const rawPun = (r.otc_prod_unit_no || '').trim();

      // Filter junk
      if (JUNK_VALUES.includes(rawPun)) {
        results.skipped_junk.push({ api: r.api_number, well_name: r.well_name, raw_pun: rawPun, reason: 'junk_value' });
        continue;
      }

      // Must have at least 5 digits to be a plausible PUN
      const digits = rawPun.replace(/[^0-9]/g, '');
      if (digits.length < 5) {
        results.skipped_junk.push({ api: r.api_number, well_name: r.well_name, raw_pun: rawPun, reason: 'too_short' });
        continue;
      }

      // Normalize to base_pun format (XXX-XXXXXX)
      const basePun = normalizeBasePun(rawPun);

      // Try to find a full PUN in the puns table that matches this base_pun
      const punMatch = await env.WELLS_DB!.prepare(`
        SELECT pun FROM puns WHERE base_pun = ? LIMIT 1
      `).bind(basePun).first<{ pun: string }>();

      // Also check otc_leases if puns table doesn't have it
      let fullPun = punMatch?.pun || null;
      let verifiedInOtc = !!fullPun;

      if (!fullPun) {
        const leaseMatch = await env.WELLS_DB!.prepare(`
          SELECT pun FROM otc_leases WHERE base_pun = ? LIMIT 1
        `).bind(basePun).first<{ pun: string }>();
        fullPun = leaseMatch?.pun || null;
        verifiedInOtc = !!fullPun;
      }

      // If we still don't have a full PUN, synthesize one from the raw value
      if (!fullPun) {
        // Try to use the raw value if it looks like a full PUN (has suffix)
        if (rawPun.match(/^\d{3}-\d{6}-\d-\d{4}$/)) {
          fullPun = rawPun;
        } else {
          // Can't create a proper full PUN — record but skip
          results.skipped_no_match.push({ api: r.api_number, well_name: r.well_name, normalized_pun: basePun });
          continue;
        }
      }

      results.promoted_list.push({
        api: r.api_number,
        well_name: r.well_name,
        pun: fullPun,
        base_pun: basePun,
        verified_in_otc: verifiedInOtc,
      });

      if (!dryRun) {
        await env.WELLS_DB!.prepare(`
          INSERT INTO well_pun_links (api_number, pun, base_pun, match_method, confidence)
          VALUES (?, ?, ?, 'occ_well_record', ?)
          ON CONFLICT(api_number, pun) DO NOTHING
        `).bind(
          r.api_number,
          fullPun,
          basePun,
          verifiedInOtc ? 'high' : 'medium'
        ).run();
      }
      results.promoted++;
    }

    return jsonResponse({ success: true, ...results });
  } catch (error) {
    console.error("Error promoting PUN links:", error);
    return jsonResponse(
      { error: "Promotion failed", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

/**
 * List tracked wells (client_wells) that are missing PUN crosswalk links.
 * Useful for identifying wells to manually look up on OKTAP.
 * Optional ?org_id=recXXX to filter by organization.
 *
 * GET /api/otc-sync/wells-missing-puns
 * GET /api/otc-sync/wells-missing-puns?org_id=recNktWjeZshSUd6N
 */
export async function handleWellsMissingPuns(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get('org_id');

    let query: string;
    let binds: any[];

    if (orgId) {
      // Filter to a specific org's tracked wells
      const memberIds = await getOrgMemberIds(env.WELLS_DB!, orgId);
      const ownerFilter = buildOwnershipFilter('cw', orgId, '', memberIds);
      query = `
        SELECT cw.id, cw.api_number, cw.well_name, cw.county, cw.operator,
               cw.section, cw.township, cw.range,
               w.otc_prod_unit_no AS occ_pun,
               w.well_status
        FROM client_wells cw
        LEFT JOIN wells w ON cw.api_number = w.api_number
        LEFT JOIN well_pun_links wpl ON cw.api_number = wpl.api_number
        WHERE wpl.api_number IS NULL
          AND cw.api_number IS NOT NULL AND cw.api_number != ''
          AND ${ownerFilter.where}
        ORDER BY cw.county, cw.well_name
      `;
      binds = [...ownerFilter.params];
    } else {
      // All tracked wells missing links
      query = `
        SELECT cw.id, cw.api_number, cw.well_name, cw.county, cw.operator,
               cw.section, cw.township, cw.range,
               w.otc_prod_unit_no AS occ_pun,
               w.well_status
        FROM client_wells cw
        LEFT JOIN wells w ON cw.api_number = w.api_number
        LEFT JOIN well_pun_links wpl ON cw.api_number = wpl.api_number
        WHERE wpl.api_number IS NULL
          AND cw.api_number IS NOT NULL AND cw.api_number != ''
        ORDER BY cw.county, cw.well_name
        LIMIT 500
      `;
      binds = [];
    }

    const results = await env.WELLS_DB!.prepare(query).bind(...binds).all();

    // Separate into two buckets: has OCC PUN (fallback active) vs no PUN at all
    const withFallbackPun: any[] = [];
    const noPun: any[] = [];

    for (const row of results.results) {
      const r = row as any;
      const occPun = (r.occ_pun || '').trim();
      if (occPun && occPun !== 'N/A' && occPun !== 'NA' && occPun.length >= 5) {
        withFallbackPun.push(r);
      } else {
        noPun.push(r);
      }
    }

    return jsonResponse({
      success: true,
      total: results.results.length,
      with_fallback_pun: {
        count: withFallbackPun.length,
        description: "Have OCC PUN in wells table (fallback works) but no formal well_pun_links entry — promote these first",
        wells: withFallbackPun,
      },
      no_pun_at_all: {
        count: noPun.length,
        description: "No PUN anywhere — need manual OKTAP lookup by API number",
        wells: noPun,
      },
    });
  } catch (error) {
    console.error("Error querying wells missing PUNs:", error);
    return jsonResponse(
      { error: "Query failed", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

