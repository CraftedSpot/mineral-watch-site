import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { TEXT_DARK, SLATE, BORDER } from '../../lib/constants';

interface Props {
  children: ReactNode;
  /** Label shown in error UI (e.g. "Properties", "Wells") */
  label?: string;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info);
  }

  isChunkLoadError(): boolean {
    const msg = this.state.error || '';
    return msg.includes('dynamically imported module') || msg.includes('Loading chunk') || msg.includes('Failed to fetch');
  }

  handleRetry = () => {
    if (this.isChunkLoadError()) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isChunk = this.isChunkLoadError();
    const label = this.props.label || 'this section';

    return (
      <div style={{
        padding: 40, textAlign: 'center',
        border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff',
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>
          Something went wrong loading {label}
        </h3>
        <p style={{ fontSize: 13, color: SLATE, margin: '0 0 16px' }}>
          {isChunk
            ? 'A new version was deployed. Click reload to get the latest.'
            : 'An unexpected error occurred. Please try again.'}
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
}
