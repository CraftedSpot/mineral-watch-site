import { formatAnalysisText } from '../../lib/format-doc-type';
import { DARK } from '../../lib/constants';

interface Props {
  text: string;
}

export function AnalysisText({ text }: Props) {
  const elements = formatAnalysisText(text);
  if (elements.length === 0) return null;

  return (
    <div style={{
      fontSize: 14,
      color: DARK,
      lineHeight: 1.6,
      wordBreak: 'break-word',
      overflowWrap: 'break-word',
    }}>
      {elements}
    </div>
  );
}
