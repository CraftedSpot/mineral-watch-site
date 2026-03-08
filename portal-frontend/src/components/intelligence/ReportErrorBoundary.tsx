import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { TEXT_DARK, SLATE, BORDER } from '../../lib/constants';

interface Props {
  reportName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export class ReportErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Report "${this.props.reportName}" failed to load:`, error, info);
  }

  isChunkLoadError(): boolean {
    const msg = this.state.error || '';
    return msg.includes('dynamically imported module') || msg.includes('Loading chunk') || msg.includes('Failed to fetch');
  }

  handleRetry = () => {
    if (this.isChunkLoadError()) {
      // Stale chunk after deploy — full reload fetches the new index.js with correct chunk names
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const isChunk = this.isChunkLoadError();
      return (
        <div style={{
          padding: 40, textAlign: 'center',
          border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>&#9888;</div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>
            Failed to load {this.props.reportName}
          </h3>
          <p style={{ fontSize: 13, color: SLATE, margin: '0 0 16px' }}>
            {isChunk
              ? 'A new version was deployed. Click reload to get the latest.'
              : (this.state.error || 'An unexpected error occurred. This might be a network issue.')}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
              padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isChunk ? 'Reload Page' : 'Retry'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
