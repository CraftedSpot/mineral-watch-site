import type { Env } from "../types/env.js";
import { jsonResponse } from "../utils/responses";

// ─── Leases ───────────────────────────────────────────────

interface LeaseRecord {
  pun: string;
  base_pun?: string;
  county?: string;
  quarter?: string;
  section?: number;
  township?: string;
  range?: string;
  lease_name?: string;
  formation?: string;
  well_classification?: string;
}

export async function handleUploadOtcLeases(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as { records: LeaseRecord[] };
    if (!body.records?.length) {
      return jsonResponse({ message: "No records", inserted: 0 }, 200);
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);
      const statements = batch.map((r) =>
        env.WELLS_DB!.prepare(
          `INSERT OR IGNORE INTO otc_leases
           (pun, base_pun, county, quarter, section, township, range, lease_name, formation, well_classification)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          r.pun,
          r.base_pun || r.pun.substring(0, 10),
          r.county || null,
          r.quarter || null,
          r.section ?? null,
          r.township || null,
          r.range || null,
          r.lease_name || null,
          r.formation || null,
          r.well_classification || null
        )
      );
      const results = await env.WELLS_DB!.batch(statements);
      for (const result of results) {
        totalInserted += result.meta.changes || 0;
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} lease records`,
      inserted: totalInserted,
    });
  } catch (error) {
    console.error("Error uploading leases:", error);
    return jsonResponse(
      { error: "Failed to upload leases", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

// ─── Companies ────────────────────────────────────────────

interface CompanyRecord {
  company_id: string;
  company_name: string;
}

export async function handleUploadOtcCompanies(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as { records: CompanyRecord[] };
    if (!body.records?.length) {
      return jsonResponse({ message: "No records", inserted: 0 }, 200);
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);
      const statements = batch.map((r) =>
        env.WELLS_DB!.prepare(
          `INSERT OR REPLACE INTO otc_companies
           (company_id, company_name, updated_at)
           VALUES (?, ?, datetime('now'))`
        ).bind(r.company_id, r.company_name)
      );
      const results = await env.WELLS_DB!.batch(statements);
      for (const result of results) {
        totalInserted += result.meta.changes || 0;
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} company records`,
      inserted: totalInserted,
    });
  } catch (error) {
    console.error("Error uploading companies:", error);
    return jsonResponse(
      { error: "Failed to upload companies", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

// ─── Lease Operator Updates ───────────────────────────────

interface LeaseOperatorRecord {
  pun: string;
  operator_number: string;
}

export async function handleUpdateLeaseOperators(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as { records: LeaseOperatorRecord[] };
    if (!body.records?.length) {
      return jsonResponse({ message: "No records", updated: 0 }, 200);
    }

    const BATCH_SIZE = 50;
    let totalUpdated = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);
      const statements = batch.map((r) =>
        env.WELLS_DB!.prepare(
          `UPDATE otc_leases SET operator_number = ? WHERE pun = ?`
        ).bind(r.operator_number, r.pun)
      );
      const results = await env.WELLS_DB!.batch(statements);
      for (const result of results) {
        totalUpdated += result.meta.changes || 0;
      }
    }

    return jsonResponse({
      success: true,
      message: `Updated operators for ${body.records.length} PUNs`,
      updated: totalUpdated,
    });
  } catch (error) {
    console.error("Error updating lease operators:", error);
    return jsonResponse(
      { error: "Failed to update lease operators", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

// ─── Tax Periods ──────────────────────────────────────────

interface TaxPeriodRecord {
  pun: string;
  base_pun?: string;
  lease_name?: string;
  well_name?: string;
  period_start_date?: string;
  period_end_date?: string;
  is_active?: number;
  tax_rate?: number;
}

export async function handleUploadOtcTaxPeriods(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as { records: TaxPeriodRecord[] };
    if (!body.records?.length) {
      return jsonResponse({ message: "No records", inserted: 0 }, 200);
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);
      const statements = batch.map((r) =>
        env.WELLS_DB!.prepare(
          `INSERT OR REPLACE INTO otc_pun_tax_periods
           (pun, base_pun, lease_name, well_name, period_start_date, period_end_date, is_active, tax_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          r.pun,
          r.base_pun || r.pun.substring(0, 10),
          r.lease_name || null,
          r.well_name || null,
          r.period_start_date || null,
          r.period_end_date || null,
          r.is_active ?? 0,
          r.tax_rate ?? null
        )
      );
      const results = await env.WELLS_DB!.batch(statements);
      for (const result of results) {
        totalInserted += result.meta.changes || 0;
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} tax period records`,
      inserted: totalInserted,
    });
  } catch (error) {
    console.error("Error uploading tax periods:", error);
    return jsonResponse(
      { error: "Failed to upload tax periods", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

// ─── Exemptions ───────────────────────────────────────────

interface ExemptionRecord {
  pun: string;
  base_pun?: string;
  exemption_type?: string;
  code?: string;
  exemption_percentage?: number;
}

export async function handleUploadOtcExemptions(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as { records: ExemptionRecord[] };
    if (!body.records?.length) {
      return jsonResponse({ message: "No records", inserted: 0 }, 200);
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let i = 0; i < body.records.length; i += BATCH_SIZE) {
      const batch = body.records.slice(i, i + BATCH_SIZE);
      const statements = batch.map((r) =>
        env.WELLS_DB!.prepare(
          `INSERT OR REPLACE INTO otc_exemptions
           (pun, base_pun, exemption_type, code, exemption_percentage)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          r.pun,
          r.base_pun || r.pun.substring(0, 10),
          r.exemption_type || null,
          r.code || null,
          r.exemption_percentage ?? null
        )
      );
      const results = await env.WELLS_DB!.batch(statements);
      for (const result of results) {
        totalInserted += result.meta.changes || 0;
      }
    }

    return jsonResponse({
      success: true,
      message: `Processed ${body.records.length} exemption records`,
      inserted: totalInserted,
    });
  } catch (error) {
    console.error("Error uploading exemptions:", error);
    return jsonResponse(
      { error: "Failed to upload exemptions", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}
