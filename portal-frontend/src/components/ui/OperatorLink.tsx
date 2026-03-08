import { useState, useCallback } from 'react';
import { fetchOperatorLookup } from '../../api/intelligence';

/**
 * Shared operator-name-click handler.
 *
 * Usage:
 *   const { handleClick, modal } = useOperatorLink();
 *   // In JSX:
 *   <OperatorName name={name} onClick={handleClick} />
 *   {modal}   // renders the OperatorModal portal when open
 *
 * Or use the all-in-one <OperatorLink name="..." /> component.
 */

// Lazy import to avoid circular deps and keep the modal chunk separate
let OperatorModalModule: any = null;
const loadModal = () => {
  if (!OperatorModalModule) {
    OperatorModalModule = import('../intelligence/operators/OperatorModal');
  }
  return OperatorModalModule;
};

interface OperatorLinkProps {
  /** Operator name to display and look up */
  name: string | null | undefined;
  /** If operator_number is already known, skip the lookup */
  operatorNumber?: string;
  /** Override the rendered text (defaults to name) */
  children?: React.ReactNode;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Font size override */
  fontSize?: number | string;
  /** Font weight override */
  fontWeight?: number | string;
}

export function OperatorLink({ name, operatorNumber, children, style, fontSize, fontWeight }: OperatorLinkProps) {
  const [modalState, setModalState] = useState<{ number: string; name: string } | null>(null);
  const [ModalComponent, setModalComponent] = useState<any>(null);
  const [looking, setLooking] = useState(false);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!name) return;

    if (operatorNumber) {
      // We already have the number — load modal directly
      const mod = await loadModal();
      setModalComponent(() => mod.OperatorModal);
      setModalState({ number: operatorNumber, name });
      return;
    }

    // Name-based lookup
    setLooking(true);
    try {
      const result = await fetchOperatorLookup(name);
      if (result?.operator_number) {
        const mod = await loadModal();
        setModalComponent(() => mod.OperatorModal);
        setModalState({ number: result.operator_number, name: result.company_name || name });
      } else {
        console.warn(`Operator lookup: no match for "${name}"`);
      }
    } catch (err) {
      console.warn(`Operator lookup failed for "${name}":`, err);
    } finally {
      setLooking(false);
    }
  }, [name, operatorNumber]);

  if (!name) return <span style={style}>{children || '\u2014'}</span>;

  return (
    <>
      <span
        role="button"
        onClick={handleClick}
        style={{
          color: '#3b82f6',
          cursor: looking ? 'wait' : 'pointer',
          fontWeight: fontWeight ?? 500,
          fontSize: fontSize,
          opacity: looking ? 0.7 : 1,
          ...style,
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
        title={`View operator details for ${name}`}
      >
        {children || name}
      </span>
      {modalState && ModalComponent && (
        <ModalComponent
          operatorNumber={modalState.number}
          operatorName={modalState.name}
          onClose={() => setModalState(null)}
        />
      )}
    </>
  );
}
