import { Env } from "../index";
import { jsonResponse } from "../utils/responses";

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
            `INSERT INTO otc_production (pun, year_month, product_code, gross_volume, gross_value)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(pun, year_month, product_code) DO UPDATE SET
               gross_volume = gross_volume + excluded.gross_volume,
               gross_value = gross_value + excluded.gross_value`
          ).bind(
            record.pun,
            record.year_month,
            record.product_code,
            record.gross_volume,
            record.gross_value || 0
          );
        } else {
          // Replace mode: overwrite existing values (default, for full reloads)
          return env.WELLS_DB!.prepare(
            `INSERT INTO otc_production (pun, year_month, product_code, gross_volume, gross_value)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(pun, year_month, product_code) DO UPDATE SET
               gross_volume = excluded.gross_volume,
               gross_value = excluded.gross_value`
          ).bind(
            record.pun,
            record.year_month,
            record.product_code,
            record.gross_volume,
            record.gross_value || 0
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

    const duration = Date.now() - startTime;

    return jsonResponse({
      success: true,
      message: county
        ? `PUN rollups computed for county ${county}`
        : "PUN rollups computed successfully",
      county: county || "all",
      dataHorizon: referenceYearMonth,
      stats: {
        step1_aggregates: step1Changes,
        step2_peak_month: step2Changes,
        step3_staleness: step3Changes,
        step4_decline_rate: step4Changes,
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

    return jsonResponse({
      success: true,
      message: `otc_production table truncated in ${iterations} batches`,
      records_deleted: totalDeleted,
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
