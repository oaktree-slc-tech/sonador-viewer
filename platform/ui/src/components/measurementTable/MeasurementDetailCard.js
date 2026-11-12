import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { displayAttributes } from '@ohif/core';
import { Icons } from '@ohif/ui-next';

import { Icon } from './../../elements/Icon';


// The measurement detail card of the Annotations panel: everything the tool knows about a
// measurement, beside its row. Header (tool, row number, state), the primary value, the value
// sections with what the viewport label shows, then Reference, Meta and Appearance. Sections
// appear only when they have content. A pending measurement's values toggle the viewport label
// (at least one stays on); a saved one marks the values its label shows.

const EyeIcon = () => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);

const EyeOffIcon = () => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18M10 6a10 10 0 0 1 2-.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3 3.7M6.5 7.6A17 17 0 0 0 2 12s3.6 6.5 10 6.5a10 10 0 0 0 4-.9" />
  </svg>
);

/** A color's name in the annotation palette, else its hex value */
function colorName(hex) {
  const match = (displayAttributes.ANNOTATION_PALETTE || []).find(color => String(color.hex).toUpperCase() === String(hex).toUpperCase());
  return match ? match.name : String(hex).toUpperCase();
}

const ReferenceRow = ({ label, children }) => (
  <div className="detailRef">
    <span className="detailLabel">{label}</span>
    <span className="detailRefValue">{children}</span>
  </div>
);

ReferenceRow.propTypes = { label: PropTypes.node, children: PropTypes.node };


const MeasurementDetailCard = ({
  detail, rowNumber, isPending, isSaved, editable, disabled, reference, outOfPlaneNote, meta, appearance, onViewportValuesChange,
}) => {
  const { t } = useTranslation('MeasurementTable');
  const { primary } = detail;
  const shown = detail.sections.flatMap(section => section.items.filter(entry => entry.inViewport).map(entry => entry.key));

  const toggle = (key) => {
    const next = shown.includes(key) ? shown.filter(value => value !== key) : [...shown, key];
    // At least one value stays in the viewport label
    if (next.length && typeof onViewportValuesChange === 'function') {
      onViewportValuesChange(next);
    }
  };

  const marker = (entry) => {
    if (editable) {
      const label = t(entry.inViewport ? 'Hide {{value}} in viewport' : 'Show {{value}} in viewport', { value: t(entry.label) });
      const lastShown = entry.inViewport && shown.length === 1;
      return (
        <button
          type="button"
          className={`detailToggle ${entry.inViewport ? '' : 'isOff'}`}
          aria-pressed={entry.inViewport}
          aria-label={label}
          title={label}
          disabled={disabled || lastShown}
          data-cy={`measurement-detail-toggle-${entry.key}`}
          onClick={(event) => {
            event.stopPropagation();
            toggle(entry.key);
          }}
        >
          {entry.inViewport ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      );
    }
    return entry.inViewport
      ? <span className="detailPin" role="img" aria-label={t('Shown in viewport')} />
      : <span aria-hidden="true" />;
  };

  // Only the meta attributes that are set; with none, the section is left out
  const metaLines = [
    { key: 'location', label: 'Location', value: meta && meta.location },
    { key: 'description', label: 'Description', value: meta && meta.description },
  ].filter(({ value }) => typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null);

  return (
    <div className="measurementDetailCardBody" data-cy="measurement-detail-card">
      <div className="detailHeader">
        <span className="detailTile"><Icon name={detail.icon} width="24px" height="24px" aria-hidden="true" /></span>
        <div className="detailTitle">
          <div className="detailName">{t(detail.toolName)}</div>
          <div className="detailDescriptor">{t(detail.descriptor)}</div>
        </div>
        <div className="detailChips">
          {rowNumber !== undefined && rowNumber !== null && <span className="detailChip">#{rowNumber}</span>}
          {isPending && <span className="detailChip isPending">{t('Pending')}</span>}
          {isSaved && <span className="detailChip"><Icons.Lock aria-hidden="true" className="detailChipLock" />{t('Saved')}</span>}
        </div>
      </div>

      {primary && (
        <div className="detailPrimary" data-cy="measurement-detail-primary">
          {primary.value}
          {primary.unit && <small>{primary.unit}</small>}
        </div>
      )}

      {detail.sections.map((section, index) => (
        <div key={section.title} className="detailSection">
          <div className="detailSectionHeader">
            {t(section.title)}
            {index === 0 && editable && <span>{t('Show in viewport')}</span>}
          </div>
          {section.items.map(entry => (
            <div key={entry.key} className="detailValue" data-cy={`measurement-detail-value-${entry.key}`}>
              <span className="detailLabel">{t(entry.label)}</span>
              <span className="detailNumber">{entry.value}</span>
              {marker(entry)}
            </div>
          ))}
        </div>
      ))}

      {reference && (
        <div className="detailSection">
          <div className="detailSectionHeader">{t('Reference')}</div>
          {reference.series && <ReferenceRow label={t('Series')}>{reference.series}</ReferenceRow>}
          {reference.view && <ReferenceRow label={t('View')}>{reference.view}</ReferenceRow>}
          {!reference.view && reference.image && <ReferenceRow label={t('Image')}>{reference.image}</ReferenceRow>}
          {reference.modality && <ReferenceRow label={t('Modality')}>{reference.modality}</ReferenceRow>}
          {outOfPlaneNote && <div className="detailNote">{outOfPlaneNote}</div>}
        </div>
      )}

      {metaLines.length > 0 && (
        <div className="detailSection">
          <div className="detailSectionHeader">{t('Meta')}</div>
          {metaLines.map(({ key, label, value }) => <ReferenceRow key={key} label={t(label)}>{value}</ReferenceRow>)}
        </div>
      )}

      {appearance && (appearance.line || appearance.text) && (
        <div className="detailSection">
          <div className="detailSectionHeader">{t('Appearance')}</div>
          {appearance.line && (
            <ReferenceRow label={t('Line')}>
              <span className="detailSwatch" style={{ backgroundColor: appearance.line }} />{colorName(appearance.line)}
            </ReferenceRow>
          )}
          {appearance.text && (
            <ReferenceRow label={t('Text')}>
              <span className="detailSwatch" style={{ backgroundColor: appearance.text }} />{colorName(appearance.text)}
            </ReferenceRow>
          )}
        </div>
      )}
    </div>
  );
};

MeasurementDetailCard.propTypes = {
  /** The measurement's detail (@ohif/core measurements/tools/measurementDetail) */
  detail: PropTypes.object.isRequired,
  rowNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  isPending: PropTypes.bool,
  isSaved: PropTypes.bool,
  /** A pending, editable measurement: its values toggle the viewport label */
  editable: PropTypes.bool,
  /** A hidden measurement: its toggles are disabled */
  disabled: PropTypes.bool,
  /** { series, image, view, modality } */
  reference: PropTypes.object,
  outOfPlaneNote: PropTypes.node,
  /** { location, description } */
  meta: PropTypes.object,
  /** { line, text }: custom colors */
  appearance: PropTypes.object,
  onViewportValuesChange: PropTypes.func,
};


export { MeasurementDetailCard };
export default MeasurementDetailCard;
