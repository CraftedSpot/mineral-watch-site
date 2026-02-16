/**
 * Airtable Service
 * Writes forum post records to MKT: Forum Monitor table
 */

const AIRTABLE_API_URL = 'https://api.airtable.com/v0';
const TABLE_NAME = 'MKT: Forum Monitor';
const BATCH_SIZE = 10;
const BATCH_DELAY = 500;

/**
 * Write a batch of forum post records to Airtable
 * @param {Object} env - Worker environment
 * @param {Array<Object>} posts - Parsed forum post data
 * @returns {Promise<Array>} - Created record IDs
 */
export async function writeForumPosts(env, posts) {
  if (!posts || posts.length === 0) return [];

  const createdIds = [];

  // Process in batches of 10 (Airtable limit)
  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);

    const records = batch.map((post) => ({
      fields: {
        'Post Title': (post.title || '').substring(0, 200),
        'Post URL': post.url || '',
        'Author': post.author || '',
        'Posted At': formatDateForAirtable(post.postedAt),
        'Category': post.category || '',
        'Detected Location': post.detectedLocation || '',
        'Detected County': post.detectedCounty || null,
        'Detected STR': post.detectedSTR || '',
        'Post Excerpt': (post.excerpt || '').substring(0, 500),
        'Response Status': 'New',
      },
    }));

    // Remove null/empty fields to avoid Airtable errors
    for (const record of records) {
      for (const [key, value] of Object.entries(record.fields)) {
        if (value === null || value === '') {
          delete record.fields[key];
        }
      }
      // Always set Response Status
      record.fields['Response Status'] = 'New';
    }

    const response = await fetch(
      `${AIRTABLE_API_URL}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Airtable] Batch write failed: ${response.status} - ${error}`);
      throw new Error(`Airtable write failed: ${response.status}`);
    }

    const result = await response.json();
    const ids = (result.records || []).map((r) => r.id);
    createdIds.push(...ids);

    console.log(`[Airtable] Wrote batch of ${batch.length} records (${ids.length} created)`);

    // Delay between batches
    if (i + BATCH_SIZE < posts.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY));
    }
  }

  return createdIds;
}

/**
 * Convert ISO datetime to YYYY-MM-DD for Airtable date fields
 */
function formatDateForAirtable(isoString) {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}
