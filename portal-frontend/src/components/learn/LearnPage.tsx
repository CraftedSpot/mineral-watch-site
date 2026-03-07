import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { TEXT_DARK, SLATE, BORDER, ORANGE } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';

const VIDEOS = [
  {
    title: 'Adding a Property',
    category: 'Getting Started',
    duration: '2 min',
    vimeoId: '1148811568',
    description: 'Learn how to add an individual property to your monitoring list using the Section-Township-Range format.',
  },
  {
    title: 'Bulk Uploading Properties',
    category: 'Getting Started',
    duration: '2 min',
    vimeoId: '1148809866',
    description: 'Save time by importing multiple properties at once using our CSV upload feature.',
  },
];

const QUICK_LINKS = [
  {
    title: 'OCC Well Records Search',
    description: 'Search Oklahoma Corporation Commission well records and filings.',
    href: 'https://public.occ.ok.gov/',
    icon: '🔍',
  },
  {
    title: 'Contact Support',
    description: 'Have questions? Reach out to our support team.',
    href: 'mailto:support@mymineralwatch.com',
    icon: '✉️',
  },
];

export function LearnPage() {
  const isMobile = useIsMobile();

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: '30px 25px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: TEXT_DARK, margin: '0 0 4px' }}>Learn</h2>
      <p style={{ fontSize: 13, color: SLATE, margin: '0 0 24px' }}>
        Quick tutorials to help you get the most out of Mineral Watch
      </p>

      {/* Video grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 20,
        marginBottom: 24,
      }}>
        {VIDEOS.map((video) => (
          <Card key={video.vimeoId} padding={0}>
            <div style={{
              position: 'relative',
              paddingBottom: '56.25%',
              background: '#000',
              borderRadius: '8px 8px 0 0',
              overflow: 'hidden',
            }}>
              <iframe
                src={`https://player.vimeo.com/video/${video.vimeoId}?badge=0&autopause=0&player_id=0`}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title={video.title}
              />
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Badge bg="rgba(192,86,33,0.1)" color={ORANGE} size="sm" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
                  {video.category}
                </Badge>
                <span style={{ fontSize: 11, color: SLATE }}>{video.duration}</span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 4px' }}>
                {video.title}
              </h3>
              <p style={{ fontSize: 13, color: SLATE, margin: 0, lineHeight: 1.5 }}>
                {video.description}
              </p>
            </div>
          </Card>
        ))}
      </div>

      {/* Coming soon */}
      <div style={{
        border: `2px dashed ${BORDER}`,
        borderRadius: 8,
        padding: 32,
        textAlign: 'center',
        marginBottom: 24,
      }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 6px' }}>
          More tutorials coming soon
        </h3>
        <p style={{ fontSize: 13, color: SLATE, margin: 0 }}>
          We're working on additional guides covering alerts, tracking wells, and understanding OCC filings.
        </p>
      </div>

      {/* Quick links */}
      <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>
        Helpful Resources
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
      }}>
        {QUICK_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target={link.href.startsWith('http') ? '_blank' : undefined}
            rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 16, background: '#fff', borderRadius: 8,
              border: `1px solid ${BORDER}`, textDecoration: 'none',
              transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
          >
            <span style={{
              fontSize: 20, width: 40, height: 40, borderRadius: 8,
              background: '#f8fafc', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0,
            }}>
              {link.icon}
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{link.title}</div>
              <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>{link.description}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
