import { Env } from '../types';

const YT_API = 'https://www.googleapis.com/youtube/v3';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function parseDuration(iso: string): number {
  // PT1H2M3S → seconds
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 3600) + (parseInt(match[2] || '0') * 60) + parseInt(match[3] || '0');
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function handleYouTube(request: Request, env: Env): Promise<Response> {
  const apiKey = env.YOUTUBE_API_KEY;
  const channelId = env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    return jsonResponse({ error: 'YouTube not configured' }, 500);
  }

  try {
    // Fetch channel stats and recent videos in parallel
    const [channelRes, searchRes] = await Promise.all([
      fetch(`${YT_API}/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`),
      fetch(`${YT_API}/search?part=snippet&channelId=${channelId}&order=date&maxResults=20&type=video&key=${apiKey}`),
    ]);

    const channelData = await channelRes.json() as any;
    const searchData = await searchRes.json() as any;

    // Parse channel info
    const ch = channelData.items?.[0];
    const channel = ch ? {
      name: ch.snippet?.title || '',
      subscribers: parseInt(ch.statistics?.subscriberCount || '0'),
      totalViews: parseInt(ch.statistics?.viewCount || '0'),
      videoCount: parseInt(ch.statistics?.videoCount || '0'),
      thumbnail: ch.snippet?.thumbnails?.default?.url || '',
    } : null;

    // Get video IDs from search results
    const videoIds = (searchData.items || [])
      .map((item: any) => item.id?.videoId)
      .filter(Boolean);

    let videos: any[] = [];

    if (videoIds.length > 0) {
      // Fetch detailed stats for each video
      const videoRes = await fetch(
        `${YT_API}/videos?part=statistics,contentDetails,snippet&id=${videoIds.join(',')}&key=${apiKey}`
      );
      const videoData = await videoRes.json() as any;

      videos = (videoData.items || []).map((v: any) => {
        const dur = parseDuration(v.contentDetails?.duration || 'PT0S');
        return {
          id: v.id,
          title: v.snippet?.title || '',
          publishedAt: v.snippet?.publishedAt || '',
          thumbnail: v.snippet?.thumbnails?.medium?.url || '',
          views: parseInt(v.statistics?.viewCount || '0'),
          likes: parseInt(v.statistics?.likeCount || '0'),
          comments: parseInt(v.statistics?.commentCount || '0'),
          duration: formatDuration(dur),
          durationSec: dur,
        };
      });
    }

    // Calculate totals across videos
    const totalVideoViews = videos.reduce((sum: number, v: any) => sum + v.views, 0);
    const totalLikes = videos.reduce((sum: number, v: any) => sum + v.likes, 0);
    const totalComments = videos.reduce((sum: number, v: any) => sum + v.comments, 0);
    const avgViews = videos.length > 0 ? Math.round(totalVideoViews / videos.length) : 0;

    return jsonResponse({
      channel,
      videos,
      summary: {
        totalVideoViews,
        totalLikes,
        totalComments,
        avgViewsPerVideo: avgViews,
      },
    });
  } catch (err: any) {
    console.error('YouTube API error:', err);
    return jsonResponse({ error: err.message || 'YouTube API error' }, 500);
  }
}
