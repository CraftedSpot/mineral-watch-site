/**
 * OTC File Sync Handler
 *
 * Tracks downloaded files from OTC SFTP to avoid re-downloading.
 * Used by the Fly.io OTC fetch automation.
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

interface FileSyncRecord {
  filename: string;
  downloaded_at: string | null;
  processed_at: string | null;
  file_size: number | null;
  status: string;
  error_message: string | null;
}

/**
 * Get list of tracked files
 * GET /api/otc-sync/files?status=complete
 */
export async function handleGetOtcSyncFiles(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = 'SELECT * FROM otc_file_sync';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY filename DESC';

    const result = params.length > 0
      ? await env.WELLS_DB.prepare(query).bind(...params).all()
      : await env.WELLS_DB.prepare(query).all();

    return jsonResponse({
      success: true,
      files: result.results || [],
      count: result.results?.length || 0
    });

  } catch (error) {
    console.error('[OtcSync] Error fetching files:', error);
    return jsonResponse({
      error: 'Failed to fetch sync files',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Check if a file is already tracked
 * GET /api/otc-sync/check?filename=exp_gpland20260112.csv
 */
export async function handleCheckOtcFile(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const url = new URL(request.url);
    const filename = url.searchParams.get('filename');

    if (!filename) {
      return jsonResponse({ error: 'filename parameter required' }, 400);
    }

    const result = await env.WELLS_DB.prepare(
      'SELECT * FROM otc_file_sync WHERE filename = ?'
    ).bind(filename).first();

    if (result) {
      return jsonResponse({
        exists: true,
        file: result
      });
    } else {
      return jsonResponse({
        exists: false,
        file: null
      });
    }

  } catch (error) {
    console.error('[OtcSync] Error checking file:', error);
    return jsonResponse({
      error: 'Failed to check file',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Check multiple files at once (for batch operations)
 * POST /api/otc-sync/check-batch
 * Body: { filenames: ["file1.csv", "file2.csv", ...] }
 */
export async function handleCheckOtcFilesBatch(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const body = await request.json() as { filenames?: string[] };
    const filenames = body.filenames;

    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return jsonResponse({ error: 'filenames array required' }, 400);
    }

    // Query all files in one go
    const placeholders = filenames.map(() => '?').join(',');
    const result = await env.WELLS_DB.prepare(
      `SELECT filename, status FROM otc_file_sync WHERE filename IN (${placeholders})`
    ).bind(...filenames).all();

    // Build a map of existing files
    const existingFiles: Record<string, string> = {};
    for (const row of (result.results || []) as { filename: string; status: string }[]) {
      existingFiles[row.filename] = row.status;
    }

    // Determine which files need to be downloaded
    const needsDownload = filenames.filter(f => !existingFiles[f]);

    return jsonResponse({
      success: true,
      existing: existingFiles,
      needs_download: needsDownload,
      existing_count: Object.keys(existingFiles).length,
      needs_download_count: needsDownload.length
    });

  } catch (error) {
    console.error('[OtcSync] Error checking files batch:', error);
    return jsonResponse({
      error: 'Failed to check files',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Record a file download/update status
 * POST /api/otc-sync/record
 * Body: { filename, status, file_size?, error_message? }
 */
export async function handleRecordOtcFile(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const body = await request.json() as {
      filename?: string;
      status?: string;
      file_size?: number;
      error_message?: string;
    };

    const { filename, status, file_size, error_message } = body;

    if (!filename) {
      return jsonResponse({ error: 'filename required' }, 400);
    }

    if (!status || !['pending', 'downloaded', 'processing', 'complete', 'error'].includes(status)) {
      return jsonResponse({ error: 'Valid status required (pending, downloaded, processing, complete, error)' }, 400);
    }

    const now = new Date().toISOString();

    // Determine timestamps based on status
    let downloadedAt = null;
    let processedAt = null;

    if (status === 'downloaded' || status === 'processing' || status === 'complete') {
      downloadedAt = now;
    }
    if (status === 'complete') {
      processedAt = now;
    }

    // Upsert the record
    await env.WELLS_DB.prepare(`
      INSERT INTO otc_file_sync (filename, downloaded_at, processed_at, file_size, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(filename) DO UPDATE SET
        downloaded_at = COALESCE(excluded.downloaded_at, downloaded_at),
        processed_at = COALESCE(excluded.processed_at, processed_at),
        file_size = COALESCE(excluded.file_size, file_size),
        status = excluded.status,
        error_message = excluded.error_message
    `).bind(filename, downloadedAt, processedAt, file_size || null, status, error_message || null).run();

    return jsonResponse({
      success: true,
      filename,
      status
    });

  } catch (error) {
    console.error('[OtcSync] Error recording file:', error);
    return jsonResponse({
      error: 'Failed to record file',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
