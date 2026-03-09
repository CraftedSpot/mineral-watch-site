/**
 * Invalidate chain_tree_cache and trigger edge rebuild for a property.
 * Handles comma-separated property_id values.
 *
 * Shared by corrections.ts and document-parties.ts.
 */
import type { Env } from '../types/env.js';

export async function invalidateAndRebuild(env: Env, propertyId: string | null): Promise<void> {
  if (!propertyId) return;

  // property_id can be comma-separated (multi-property documents)
  const propertyIds = propertyId.split(',').map(p => p.trim()).filter(Boolean);

  for (const pid of propertyIds) {
    // Delete cache
    await env.WELLS_DB.prepare(
      `DELETE FROM chain_tree_cache WHERE property_id = ?`
    ).bind(pid).run();

    // Trigger edge rebuild via service binding
    if (env.DOCUMENTS_WORKER) {
      try {
        await env.DOCUMENTS_WORKER.fetch(new Request('https://internal/api/internal/build-chain-edges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property_id: pid }),
        }));
      } catch (err) {
        console.error(`[InvalidateRebuild] Edge rebuild failed for ${pid}:`, err);
      }
    }
  }
}
