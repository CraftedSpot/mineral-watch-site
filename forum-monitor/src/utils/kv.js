/**
 * KV Utilities
 * Tracks seen topic IDs and run metadata
 */

const SEEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Check if a topic has been seen before
 * @param {KVNamespace} kv - FORUM_CACHE KV namespace
 * @param {number} topicId - Discourse topic ID
 * @returns {Promise<boolean>}
 */
export async function isTopicSeen(kv, topicId) {
  const key = `seen:topic:${topicId}`;
  const value = await kv.get(key);
  return value !== null;
}

/**
 * Mark a topic as seen
 * @param {KVNamespace} kv - FORUM_CACHE KV namespace
 * @param {number} topicId - Discourse topic ID
 */
export async function markTopicSeen(kv, topicId) {
  const key = `seen:topic:${topicId}`;
  await kv.put(key, new Date().toISOString(), { expirationTtl: SEEN_TTL });
}

/**
 * Batch check which topics are new (not seen)
 * @param {KVNamespace} kv - FORUM_CACHE KV namespace
 * @param {Array<number>} topicIds - Topic IDs to check
 * @returns {Promise<Set<number>>} - Set of new (unseen) topic IDs
 */
export async function filterNewTopics(kv, topicIds) {
  const newTopics = new Set();

  // Check each topic individually (KV doesn't support batch get)
  // With ~30 topics per check, this is fine
  const checks = await Promise.all(
    topicIds.map(async (id) => {
      const seen = await isTopicSeen(kv, id);
      return { id, seen };
    })
  );

  for (const { id, seen } of checks) {
    if (!seen) {
      newTopics.add(id);
    }
  }

  return newTopics;
}

/**
 * Mark multiple topics as seen
 * @param {KVNamespace} kv - FORUM_CACHE KV namespace
 * @param {Array<number>} topicIds - Topic IDs to mark
 */
export async function markTopicsSeen(kv, topicIds) {
  await Promise.all(topicIds.map((id) => markTopicSeen(kv, id)));
}

/**
 * Update last run metadata
 * @param {KVNamespace} kv - FORUM_CACHE KV namespace
 * @param {Object} metadata - Run metadata
 */
export async function updateLastRun(kv, metadata) {
  await kv.put(
    'last-run',
    JSON.stringify({
      ...metadata,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Get last run metadata
 * @param {KVNamespace} kv - FORUM_CACHE KV namespace
 * @returns {Promise<Object|null>}
 */
export async function getLastRun(kv) {
  const value = await kv.get('last-run');
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
