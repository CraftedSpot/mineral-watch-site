/**
 * Forum Monitor Worker
 * Scrapes Mineral Rights Forum for Oklahoma posts, detects locations, tracks in Airtable
 */

import { fetchLatestTopics, fetchTopicContent, buildUserMap, getOriginalPoster } from './scrapers/discourse.js';
import { parseLocations } from './parsers/location.js';
import { writeForumPosts } from './services/airtable.js';
import { sendForumDigest } from './services/email.js';
import { filterNewTopics, markTopicsSeen, updateLastRun, getLastRun } from './utils/kv.js';

// Discourse category names by ID (Oklahoma subcategories)
// We'll populate this from the forum API response if available
const CATEGORY_NAMES = {
  48: 'Oklahoma',
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runForumMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Manual trigger
    if (url.pathname === '/trigger/forum') {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.TRIGGER_SECRET}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      const result = await runForumMonitor(env);
      return jsonResponse(result);
    }

    // Health check
    if (url.pathname === '/health') {
      const lastRun = await getLastRun(env.FORUM_CACHE);
      return jsonResponse({ status: 'ok', lastRun });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

/**
 * Main monitor flow
 */
async function runForumMonitor(env) {
  const startTime = Date.now();
  console.log('[ForumMonitor] Starting run...');

  try {
    // 1. Fetch latest Oklahoma topics from Discourse
    const { topics, users } = await fetchLatestTopics(
      env.FORUM_BASE_URL,
      env.OKLAHOMA_CATEGORY_ID
    );

    if (topics.length === 0) {
      console.log('[ForumMonitor] No topics found');
      await updateLastRun(env.FORUM_CACHE, {
        topicsChecked: 0,
        newPosts: 0,
        duration: Date.now() - startTime,
      });
      return { ok: true, newPosts: 0 };
    }

    // 2. Filter to only new (unseen) topics
    const topicIds = topics.map((t) => t.id);
    const newTopicIds = await filterNewTopics(env.FORUM_CACHE, topicIds);

    console.log(`[ForumMonitor] ${newTopicIds.size} new topics out of ${topics.length} total`);

    if (newTopicIds.size === 0) {
      await updateLastRun(env.FORUM_CACHE, {
        topicsChecked: topics.length,
        newPosts: 0,
        duration: Date.now() - startTime,
      });
      return { ok: true, newPosts: 0 };
    }

    // 3. Build user lookup map
    const userMap = buildUserMap(users);

    // 4. For each new topic, fetch content and parse locations
    const newTopics = topics.filter((t) => newTopicIds.has(t.id));
    const parsedPosts = [];

    for (const topic of newTopics) {
      try {
        // Fetch full topic content
        const { firstPost } = await fetchTopicContent(
          env.FORUM_BASE_URL,
          topic.slug,
          topic.id
        );

        if (!firstPost) {
          console.warn(`[ForumMonitor] No first post for topic ${topic.id}`);
          continue;
        }

        // Parse locations from post text (prefer raw markdown, fall back to cooked HTML)
        const postText = firstPost.raw || firstPost.cooked || '';
        const locations = parseLocations(postText);

        // Get author info
        const op = getOriginalPoster(topic.posters, userMap);
        const author = firstPost.username || op?.username || 'Unknown';

        // Get category name
        const category = CATEGORY_NAMES[topic.category_id] || `Category ${topic.category_id}`;

        // Build post record
        const postData = {
          topicId: topic.id,
          title: topic.title,
          url: `${env.FORUM_BASE_URL}/t/${topic.slug}/${topic.id}`,
          author,
          postedAt: topic.created_at,
          category,
          excerpt: stripHtml(postText).substring(0, 500),
          ...locations,
        };

        parsedPosts.push(postData);

        console.log(
          `[ForumMonitor] Parsed topic ${topic.id}: "${topic.title}" ` +
            `[STR: ${locations.detectedSTR || 'none'}, County: ${locations.detectedCounty || 'none'}]`
        );

        // Small delay between topic fetches to be polite
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.error(`[ForumMonitor] Error processing topic ${topic.id}: ${err.message}`);
      }
    }

    // 5. Write to Airtable (unless dry run)
    let airtableIds = [];
    if (env.DRY_RUN !== 'true' && parsedPosts.length > 0) {
      try {
        airtableIds = await writeForumPosts(env, parsedPosts);
        console.log(`[ForumMonitor] Wrote ${airtableIds.length} records to Airtable`);
      } catch (err) {
        console.error(`[ForumMonitor] Airtable write error: ${err.message}`);
      }
    }

    // 6. Send digest email
    if (env.DRY_RUN !== 'true' && parsedPosts.length > 0) {
      try {
        await sendForumDigest(env, parsedPosts);
      } catch (err) {
        console.error(`[ForumMonitor] Email send error: ${err.message}`);
      }
    }

    // 7. Mark all fetched topics as seen (even if we failed to write them)
    // This prevents re-processing on the next run
    await markTopicsSeen(env.FORUM_CACHE, Array.from(newTopicIds));

    const duration = Date.now() - startTime;
    console.log(
      `[ForumMonitor] Complete: ${parsedPosts.length} new posts processed in ${duration}ms`
    );

    await updateLastRun(env.FORUM_CACHE, {
      topicsChecked: topics.length,
      newPosts: parsedPosts.length,
      airtableRecords: airtableIds.length,
      duration,
    });

    return {
      ok: true,
      newPosts: parsedPosts.length,
      airtableRecords: airtableIds.length,
      duration,
    };
  } catch (err) {
    console.error(`[ForumMonitor] Fatal error: ${err.message}`);
    await updateLastRun(env.FORUM_CACHE, {
      error: err.message,
      duration: Date.now() - startTime,
    });
    throw err;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
