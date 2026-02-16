/**
 * Discourse Forum Scraper
 * Fetches topics and posts from mineralrightsforum.com (Discourse JSON API)
 */

const USER_AGENT = 'MineralWatch ForumMonitor/1.0';

// Oklahoma subcategory IDs → county names (from /site.json, parent_category_id=48)
const CATEGORY_NAMES = {
  48: 'Oklahoma',
  758: 'Alfalfa County, OK', 636: 'Atoka County, OK', 586: 'Beaver County, OK',
  626: 'Beckham County, OK', 664: 'Blaine County, OK', 702: 'Bryan County, OK',
  621: 'Caddo County, OK', 737: 'Canadian County, OK', 714: 'Carter County, OK',
  136: 'Cimarron County, OK', 401: 'Cleveland County, OK', 628: 'Coal County, OK',
  700: 'Comanche County, OK', 199: 'Cotton County, OK', 645: 'Creek County, OK',
  705: 'Custer County, OK', 368: 'Delaware County, OK', 688: 'Dewey County, OK',
  595: 'Ellis County, OK', 568: 'Garfield County, OK', 519: 'Garvin County, OK',
  650: 'Grady County, OK', 492: 'Grant County, OK', 365: 'Greer County, OK',
  379: 'Harmon County, OK', 632: 'Harper County, OK', 432: 'Haskell County, OK',
  772: 'Hughes County, OK', 527: 'Jackson County, OK', 538: 'Jefferson County, OK',
  374: 'Johnston County, OK', 522: 'Kay County, OK', 629: 'Kingfisher County, OK',
  247: 'Kiowa County, OK', 575: 'Latimer County, OK', 599: 'Le Flore County, OK',
  638: 'Lincoln County, OK', 665: 'Logan County, OK', 680: 'Love County, OK',
  381: 'Major County, OK', 684: 'Marshall County, OK', 98: 'Mayes County, OK',
  651: 'McClain County, OK', 100: 'McCurtain County, OK', 648: 'McIntosh County, OK',
  396: 'Murray County, OK', 641: 'Muskogee County, OK', 596: 'Noble County, OK',
  514: 'Nowata County, OK', 643: 'Okfuskee County, OK', 637: 'Oklahoma County, OK',
  644: 'Okmulgee County, OK', 500: 'Osage County, OK', 495: 'Pawnee County, OK',
  696: 'Payne County, OK', 647: 'Pittsburg County, OK', 701: 'Pontotoc County, OK',
  661: 'Pottawatomie County, OK', 337: 'Pushmataha County, OK', 398: 'Roger Mills County, OK',
  515: 'Rogers County, OK', 639: 'Seminole County, OK', 697: 'Stephens County, OK',
  257: 'Texas County, OK', 520: 'Tillman County, OK', 640: 'Tulsa County, OK',
  642: 'Wagoner County, OK', 90: 'Washington County, OK', 612: 'Washita County, OK',
  736: 'Woods County, OK', 535: 'Woodward County, OK',
};

/**
 * Resolve a Discourse category ID to a human-readable name
 * @param {number} categoryId
 * @returns {string}
 */
export function getCategoryName(categoryId) {
  return CATEGORY_NAMES[categoryId] || `Category ${categoryId}`;
}

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
