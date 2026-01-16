import { Env } from "../index";
import { jsonResponse } from "../utils/responses";

interface ProductionRecord {
  county_number: number;
  county_name: string;
  product_code: number;
  year_month: string;
  total_volume: number;
  well_count: number;
}

interface UploadRequest {
  records: ProductionRecord[];
}

/**
 * Handle POST /api/otc-sync/upload-production
 * Uploads processed production data to D1 county_production_monthly table
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
        typeof record.total_volume !== "number"
      ) {
        return jsonResponse(
          {
            error: "Invalid record format",
            expected: {
              county_number: "number",
              county_name: "string",
              product_code: "number (1=Oil, 5=Gas)",
              year_month: "string (YYYY-MM)",
              total_volume: "number",
              well_count: "number",
            },
          },
          400
        );
      }
    }

    // Process in batches of 100 to avoid hitting D1 limits
    const BATCH_SIZE = 100;
    let totalInserted = 0;
    let totalUpdated = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);

      // Use INSERT OR REPLACE to handle upserts
      const statements = batch.map((record) => {
        return env.WELLS_DB.prepare(
          `INSERT OR REPLACE INTO county_production_monthly
           (county_number, county_name, product_code, year_month, total_volume, well_count, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(
          record.county_number,
          record.county_name,
          record.product_code,
          record.year_month,
          record.total_volume,
          record.well_count || 0
        );
      });

      // Execute batch
      const results = await env.WELLS_DB.batch(statements);

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
    const statsResult = await env.WELLS_DB.prepare(
      `SELECT
         COUNT(*) as total_records,
         COUNT(DISTINCT county_number) as county_count,
         MIN(year_month) as earliest_month,
         MAX(year_month) as latest_month,
         SUM(CASE WHEN product_code = 1 THEN total_volume ELSE 0 END) as total_oil,
         SUM(CASE WHEN product_code = 5 THEN total_volume ELSE 0 END) as total_gas
       FROM county_production_monthly`
    ).first();

    // Get record count by product
    const byProductResult = await env.WELLS_DB.prepare(
      `SELECT product_code, COUNT(*) as count, SUM(total_volume) as volume
       FROM county_production_monthly
       GROUP BY product_code`
    ).all();

    // Get latest month's data summary
    const latestMonthResult = await env.WELLS_DB.prepare(
      `SELECT year_month, COUNT(*) as records,
         SUM(CASE WHEN product_code = 1 THEN total_volume ELSE 0 END) as oil_volume,
         SUM(CASE WHEN product_code = 5 THEN total_volume ELSE 0 END) as gas_volume
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
