import { Card } from '../ui/Card';
import { TEXT_DARK, SLATE, SUCCESS_GREEN } from '../../lib/constants';
import { getPlanConfig } from '../../lib/plan-config';
import { useIsMobile } from '../../hooks/useIsMobile';

interface PlanFeaturesCardProps {
  plan: string;
}

export function PlanFeaturesCard({ plan }: PlanFeaturesCardProps) {
  const config = getPlanConfig(plan);
  const isMobile = useIsMobile();
  const cols = isMobile ? 1 : config.features.length > 6 ? 3 : 2;

  return (
    <Card padding={20}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 16px' }}>
        Your {plan} Plan Features
      </h3>
      <ul style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '8px 24px',
        margin: 0,
        padding: 0,
        listStyle: 'none',
      }}>
        {config.features.map((feature) => (
          <li key={feature} style={{
            fontSize: 13,
            color: SLATE,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ color: SUCCESS_GREEN, fontSize: 14, flexShrink: 0 }}>✓</span>
            {feature}
          </li>
        ))}
      </ul>
    </Card>
  );
}
