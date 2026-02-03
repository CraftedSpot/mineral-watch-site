import type { Env } from "../types/env.js";
import { jsonResponse } from "../utils/responses";

interface FinancialRecord {
  pun: string;
  year_month: string;
  product_code: string;
  reporting_company_id?: string;
  purchaser_id?: string;
  gross_volume?: number;
  gross_value?: number;
  net_volume?: number;
  net_value?: number;
  market_deduction?: number;
  decimal_equivalent?: number;
  exempt_volume?: number;
  exempt_value?: number;
  gp_tax?: number;
  pe_tax?: number;
  exempt_code?: string;
  report_type?: number;
  reported_at?: string;
}

interface FinancialUploadRequest {
  records: FinancialRecord[];
}

/**
 * Handle POST /api/otc-sync/upload-financial
 * Uploads financial (gpland) data to D1 otc_production_financial table
 */
export async function handleUploadFinancialData(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as FinancialUploadRequest;

    if (!body.records || !Array.isArray(body.records)) {
      return jsonResponse({ error: "Missing or invalid 'records' array" }, 400);
    }

    if (body.records.length === 0) {
      return jsonResponse({ message: "No records to upload", inserted: 0 }, 200);
    }

    // Validate required fields
    for (const record of body.records) {
      if (
        typeof record.pun !== "string" ||
        typeof record.year_month !== "string" ||
        typeof record.product_code !== "string"
      ) {
        return jsonResponse(
          {
            error: "Invalid record format",
            expected: {
              pun: "string (XXX-XXXXXX-X-XXXX)",
              year_month: "string (YYYYMM)",
              product_code: "string (1, 3, 5, or 6)",
            },
          },
          400
        );
      }
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);

      const statements = batch.map((r) => {
        return env.WELLS_DB!.prepare(
          `INSERT OR REPLACE INTO otc_production_financial
           (pun, year_month, product_code, reporting_company_id, purchaser_id,
            gross_volume, gross_value, net_volume, net_value, market_deduction,
            decimal_equivalent, exempt_volume, exempt_value, gp_tax, pe_tax,
            exempt_code, report_type, reported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          r.pun,
          r.year_month,
          r.product_code,
          r.reporting_company_id || null,
          r.purchaser_id || null,
          r.gross_volume ?? null,
          r.gross_value ?? null,
          r.net_volume ?? null,
          r.net_value ?? null,
          r.market_deduction ?? null,
          r.decimal_equivalent ?? null,
          r.exempt_volume ?? null,
          r.exempt_value ?? null,
          r.gp_tax ?? null,
          r.pe_tax ?? null,
          r.exempt_code || null,
          r.report_type ?? null,
          r.reported_at || null
        );
      });

      const results = await env.WELLS_DB!.batch(statements);
      for (const result of results) {
        if (result.meta.changes > 0) {
          totalInserted += result.meta.changes;
        }
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} financial records`,
      inserted: totalInserted,
      batches: Math.ceil(body.records.length / BATCH_SIZE),
    });
  } catch (error) {
    console.error("Error uploading financial data:", error);
    return jsonResponse(
      {
        error: "Failed to upload financial data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle GET /api/otc-sync/financial-stats
 * Returns statistics about financial data in otc_production_financial
 */
export async function handleGetFinancialStats(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const statsResult = await env.WELLS_DB!.prepare(
      `SELECT
         COUNT(*) as total_records,
         COUNT(DISTINCT pun) as unique_puns,
         MIN(year_month) as earliest_month,
         MAX(year_month) as latest_month,
         SUM(gross_value) as total_gross_value,
         SUM(net_value) as total_net_value,
         COUNT(CASE WHEN decimal_equivalent > 0 THEN 1 END) as records_with_decimal
       FROM otc_production_financial`
    ).first();

    const byProductResult = await env.WELLS_DB!.prepare(
      `SELECT product_code,
         COUNT(*) as count,
         SUM(gross_volume) as total_volume,
         SUM(gross_value) as total_value,
         SUM(net_value) as total_net_value
       FROM otc_production_financial
       GROUP BY product_code`
    ).all();

    return jsonResponse({
      overall: statsResult,
      byProduct: byProductResult.results,
    });
  } catch (error) {
    console.error("Error getting financial stats:", error);
    return jsonResponse(
      {
        error: "Failed to get financial stats",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

/**
 * Handle POST /api/otc-sync/truncate-financial
 * Truncates otc_production_financial before a full reload
 */
export async function handleTruncateFinancial(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const countBefore = await env.WELLS_DB!.prepare(
      `SELECT COUNT(*) as count FROM otc_production_financial`
    ).first() as { count: number };

    const totalRecords = countBefore?.count || 0;
    if (totalRecords === 0) {
      return jsonResponse({
        success: true,
        message: "Table already empty",
        records_deleted: 0,
      });
    }

    const BATCH_SIZE = 50000;
    let totalDeleted = 0;
    let iterations = 0;
    const maxIterations = Math.ceil(totalRecords / BATCH_SIZE) + 5;

    while (iterations < maxIterations) {
      iterations++;
      const result = await env.WELLS_DB!.prepare(
        `DELETE FROM otc_production_financial WHERE rowid IN (SELECT rowid FROM otc_production_financial LIMIT ?)`
      ).bind(BATCH_SIZE).run();

      const deleted = result.meta.changes || 0;
      totalDeleted += deleted;

      if (deleted < BATCH_SIZE) break;
    }

    return jsonResponse({
      success: true,
      message: `otc_production_financial truncated in ${iterations} batches`,
      records_deleted: totalDeleted,
    });
  } catch (error) {
    console.error("Error truncating financial data:", error);
    return jsonResponse(
      {
        error: "Failed to truncate financial data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}
