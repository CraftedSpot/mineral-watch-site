/**
 * Discourse Forum Scraper
 * Fetches topics and posts from mineralrightsforum.com (Discourse JSON API)
 */

const USER_AGENT = 'MineralWatch ForumMonitor/1.0';

/**
 * Fetch latest Oklahoma topics from Discourse
 * @param {string} baseUrl - Forum base URL
 * @param {string} categoryId - Oklahoma category ID
 * @returns {Promise<{topics: Array, users: Array}>}
 */
export async function fetchLatestTopics(baseUrl, categoryId) {
  const url = `${baseUrl}/c/oklahoma-mineral-rights/${categoryId}/l/latest.json?order=created&ascending=false&include_subcategories=true`;

  console.log(`[Discourse] Fetching topics from: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Discourse topic list failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const topics = data.topic_list?.topics || [];
  const users = data.users || [];

  console.log(`[Discourse] Found ${topics.length} topics in Oklahoma category`);

  return { topics, users };
}

/**
 * Fetch full topic content (first post)
 * @param {string} baseUrl - Forum base URL
 * @param {string} slug - Topic slug
 * @param {number} topicId - Topic ID
 * @returns {Promise<{firstPost: Object, topic: Object}>}
 */
export async function fetchTopicContent(baseUrl, slug, topicId) {
  const url = `${baseUrl}/t/${slug}/${topicId}.json`;

  console.log(`[Discourse] Fetching topic content: ${slug} (${topicId})`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Discourse topic fetch failed: ${response.status} for topic ${topicId}`);
  }

  const data = await response.json();
  const posts = data.post_stream?.posts || [];
  const firstPost = posts[0] || null;

  return {
    firstPost,
    topic: {
      id: data.id,
      title: data.title,
      slug: data.slug,
      created_at: data.created_at,
      last_posted_at: data.last_posted_at,
      posts_count: data.posts_count,
      views: data.views,
      category_id: data.category_id,
    },
  };
}

/**
 * Build a username lookup map from the users array in topic list response
 * @param {Array} users - Users array from topic list
 * @returns {Map<number, {username: string, name: string}>}
 */
export function buildUserMap(users) {
  const map = new Map();
  for (const u of users) {
    map.set(u.id, { username: u.username, name: u.name || u.username });
  }
  return map;
}

/**
 * Get the original poster from a topic's posters array
 * @param {Array} posters - Topic posters array
 * @param {Map} userMap - User ID to info map
 * @returns {{username: string, name: string} | null}
 */
export function getOriginalPoster(posters, userMap) {
  if (!posters || posters.length === 0) return null;
  // The first poster with description containing "Original Poster" or just the first poster
  const op = posters.find(p => p.description?.includes('Original Poster')) || posters[0];
  return userMap.get(op.user_id) || null;
}
