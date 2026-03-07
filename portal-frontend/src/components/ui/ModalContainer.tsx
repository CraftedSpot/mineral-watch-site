import { useEffect, Activity } from 'react';
import { createPortal } from 'react-dom';
import { FocusTrap } from './FocusTrap';
import { MODAL_BASE_Z, MODAL_Z_INCREMENT, BORDER, DARK } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ModalEntry } from '../../contexts/ModalContext';
import { PropertyModal } from '../modals/PropertyModal';
import { WellModal } from '../modals/WellModal';
import { DocumentDetailModal } from '../modals/DocumentDetailModal';
import { DocumentViewer } from '../modals/DocumentViewer';
import { CreditPackModal } from '../modals/CreditPackModal';
import { OutOfCreditsModal } from '../modals/OutOfCreditsModal';
import { UploadDocumentModal } from '../modals/UploadDocumentModal';
import { AddWellModal } from '../modals/AddWellModal';
import { AddPropertyModal } from '../modals/AddPropertyModal';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODAL_REGISTRY: Record<string, React.ComponentType<any>> = {
  'property': PropertyModal,
  'well': WellModal,
  'document-detail': DocumentDetailModal,
  'document-viewer': DocumentViewer,
  'credit-pack': CreditPackModal,
  'out-of-credits': OutOfCreditsModal,
  'upload-document': UploadDocumentModal,
  'add-well': AddWellModal,
  'add-property': AddPropertyModal,
};

interface ModalContainerProps {
  stack: ModalEntry[];
  onClose: (id?: string) => void;
}

function PlaceholderModal({ type, onClose }: { type: string; onClose: () => void }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 32,
      minWidth: 400, maxWidth: 600,
      boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
      fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: DARK }}>
          Modal: {type}
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
            padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#64748b',
          }}
        >
          Close
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
        Content will be implemented in Phase 2b.
      </p>
    </div>
  );
}

export function ModalContainer({ stack, onClose }: ModalContainerProps) {
  const isMobile = useIsMobile();

  // Escape key closes topmost
  useEffect(() => {
    if (stack.length === 0) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [stack.length, onClose]);

  // Prevent body scroll when modals are open
  useEffect(() => {
    if (stack.length > 0) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [stack.length]);

  if (stack.length === 0) return null;

  return createPortal(
    <>
      {stack.map((entry, index) => {
        const zIndex = MODAL_BASE_Z + (index * MODAL_Z_INCREMENT);
        const isTopmost = index === stack.length - 1;
        const Component = MODAL_REGISTRY[entry.type];

        return (
          <Activity key={entry.id} mode={isTopmost ? 'visible' : 'hidden'}>
            <div
              style={{
                position: 'fixed', inset: 0, zIndex,
                display: 'flex',
                alignItems: isMobile ? 'flex-start' : 'center',
                justifyContent: 'center',
                paddingTop: isMobile ? 8 : 0,
              }}
            >
              {/* Backdrop */}
              <div
                style={{
                  position: 'absolute', inset: 0,
                  background: index === 0 ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)',
                }}
                onClick={() => onClose(entry.id)}
              />
              {/* Modal content */}
              <div style={{
                position: 'relative', zIndex: 1, width: '100%',
                maxWidth: isMobile ? 'calc(100vw - 16px)' : 'calc(100vw - 40px)',
                padding: isMobile ? '0 8px' : '0 20px',
                boxSizing: 'border-box', display: 'flex', justifyContent: 'center',
              }}>
                <FocusTrap active={isTopmost}>
                  {Component ? (
                    <Component
                      {...entry.props}
                      onClose={() => onClose(entry.id)}
                      modalId={entry.id}
                    />
                  ) : (
                    <PlaceholderModal type={entry.type} onClose={() => onClose(entry.id)} />
                  )}
                </FocusTrap>
              </div>
            </div>
          </Activity>
        );
      })}
    </>,
    document.body,
  );
}
