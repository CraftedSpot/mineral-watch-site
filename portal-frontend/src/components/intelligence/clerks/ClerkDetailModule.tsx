import { createPortal } from 'react-dom';
import { ModalShell } from '../../ui/ModalShell';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED, MODAL_BASE_Z } from '../../../lib/constants';
import type { ClerkOffice } from './ClerkDirectory';

interface ClerkDetailModuleProps {
  office: ClerkOffice;
  /** All offices loaded — used to find the sibling office for this county */
  allOffices: ClerkOffice[];
  onClose: () => void;
  /** Switch to another office (sibling county/court clerk) */
  onSwitchOffice: (office: ClerkOffice) => void;
  /** Optional: open directly to a specific county + type (for future gap card integration) */
  county?: string;
  officeType?: string;
}

const sectionStyle: React.CSSProperties = {
  padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}`,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '6px 0', fontSize: 13, lineHeight: 1.5,
};
const labelStyle: React.CSSProperties = {
  color: SLATE, fontWeight: 500, minWidth: 120, flexShrink: 0,
};
const valueStyle: React.CSSProperties = {
  color: TEXT_DARK, textAlign: 'right', flex: 1,
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{children}</span>
    </div>
  );
}

export function ClerkDetailModule({ office, allOffices, onClose, onSwitchOffice }: ClerkDetailModuleProps) {
  const isCountyClerk = office.office_type === 'County Clerk';
  const siblingType = isCountyClerk ? 'Court Clerk' : 'County Clerk';
  const sibling = allOffices.find(o => o.county === office.county && o.office_type === siblingType);

  const badgeColors = isCountyClerk
    ? { bg: '#dbeafe', color: '#1e40af' }
    : { bg: '#fef3c7', color: '#92400e' };

  const headerContent = (
    <div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, fontFamily: "'Merriweather', serif", color: '#fff' }}>
        {office.office_name}
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <Badge bg={badgeColors.bg + '44'} color="#e2e8f0" size="sm">
          {office.office_type}
        </Badge>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
          {office.county} County{office.county_code ? ` (#${String(office.county_code).padStart(2, '0')})` : ''}
        </span>
      </div>
    </div>
  );

  const countySlug = office.county.toLowerCase().replace(/\s+/g, '-');

  const footer = sibling ? (
    <button
      onClick={() => onSwitchOffice(sibling)}
      style={{
        background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
        padding: '6px 14px', fontSize: 13, cursor: 'pointer',
        color: '#3b82f6', fontFamily: 'inherit', fontWeight: 500,
      }}
    >
      See {siblingType} office &rarr;
    </button>
  ) : undefined;

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: MODAL_BASE_Z,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 520, padding: '0 20px', boxSizing: 'border-box' }}>
        <ModalShell
          onClose={onClose}
          headerContent={headerContent}
          headerBg={isCountyClerk ? 'linear-gradient(135deg, #0369a1, #0284c7)' : 'linear-gradient(135deg, #92400e, #b45309)'}
          maxWidth={520}
          footer={footer}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Contact Section */}
            <div style={sectionStyle}>
              <h3 style={sectionTitle}>Contact</h3>
              {office.phone && (
                <DetailRow label="Phone">
                  <a href={`tel:${office.phone}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>
                    {office.phone}
                  </a>
                </DetailRow>
              )}
              {office.email && (
                <DetailRow label="Email">
                  <a href={`mailto:${office.email}`} style={{ color: '#3b82f6', textDecoration: 'none', wordBreak: 'break-all' }}>
                    {office.email}
                  </a>
                </DetailRow>
              )}
              {office.physical_address && (
                <DetailRow label="Address">{office.physical_address}</DetailRow>
              )}
              {office.mailing_address && office.mailing_address !== office.physical_address && (
                <DetailRow label="Mailing">{office.mailing_address}</DetailRow>
              )}
              {office.office_hours && (
                <DetailRow label="Hours">{office.office_hours}</DetailRow>
              )}
            </div>

            {/* Records Section */}
            {(office.earliest_digitized_records || office.uses_okcountyrecords) ? (
              <div style={sectionStyle}>
                <h3 style={sectionTitle}>Records</h3>
                {office.uses_okcountyrecords === 1 && (
                  <DetailRow label="Online Records">
                    <a
                      href={`https://okcountyrecords.com/search/${countySlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#3b82f6', textDecoration: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      OKCountyRecords &rarr;
                    </a>
                  </DetailRow>
                )}
                {office.earliest_digitized_records ? (
                  <DetailRow label="Digitized Since">{office.earliest_digitized_records}</DetailRow>
                ) : (
                  <DetailRow label="Digitized Since">
                    <span style={{ color: SLATE, fontStyle: 'italic' }}>Contact office for coverage dates</span>
                  </DetailRow>
                )}
              </div>
            ) : null}

            {/* Notes Section */}
            {office.notes && (
              <div style={sectionStyle}>
                <h3 style={sectionTitle}>Notes</h3>
                <p style={{ margin: 0, fontSize: 13, color: SLATE, lineHeight: 1.5 }}>{office.notes}</p>
              </div>
            )}

            {/* Verification Status */}
            {office.verification_status && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: SLATE, padding: '0 4px' }}>
                <span style={{
                  display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                  background: office.verification_status === 'needs-verification' ? '#f59e0b' : '#22c55e',
                }} />
                <span>
                  {office.verification_status === 'needs-verification' ? 'Needs verification' : 'Verified'}
                  {office.last_verified_date ? ` — ${office.last_verified_date}` : ''}
                </span>
              </div>
            )}
          </div>
        </ModalShell>
      </div>
    </div>,
    document.body,
  );
}
