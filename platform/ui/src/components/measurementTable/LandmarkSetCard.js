import React, { useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import OHIF from '@ohif/core';
import { Icons, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';


// A landmark set's row parts and its card in the Annotations panel. The card is the set's one hover
// card: the landmarks that have a name, each a link to its landmark while the set is placed, then
// the set's meta, reference and appearance. Sections appear only when they have content. The row
// data is built by the Viewer (landmarkSetRows.js): `measurementData.landmarkSet`.

/** The set icon: three points, not joined */
const LandmarkSetIcon = ({ size = 18, label }) => (
  <svg
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round"
  >
    <circle cx="6.5" cy="7" r="2.6" />
    <circle cx="17" cy="9.5" r="2.6" />
    <circle cx="10" cy="17.5" r="2.6" />
  </svg>
);

LandmarkSetIcon.propTypes = { size: PropTypes.number, label: PropTypes.string };


/** The index cell mark of a held set: a ring struck through */
const HeldSetMark = ({ label }) => (
  <span className="landmarkHeldMark">
    <svg role="img" aria-label={label} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="6.5" />
      <path d="M4.5 19.5l15-15" />
    </svg>
  </span>
);

HeldSetMark.propTypes = { label: PropTypes.string.isRequired };


/** The marker shape of a landmark type, in its Line colour: Point, Anatomic or Registration */
const LandmarkShape = ({ shape, color, size = 16 }) => (
  <svg aria-hidden="true" className="landmarkShape" data-shape={shape} width={size} height={size} viewBox="0 0 20 20">
    <g fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="miter">
      {shape === 'Anatomic' && <path d="M10 3.5L16.5 10L10 16.5L3.5 10Z" />}
      {shape === 'Registration' && <><circle cx="10" cy="10" r="4.5" /><path d="M2 10H5.5M14.5 10H18M10 2V5.5M10 14.5V18" /></>}
      {shape !== 'Anatomic' && shape !== 'Registration' && <path d="M3.5 10H7.5M12.5 10H16.5M10 3.5V7.5M10 12.5V16.5" />}
    </g>
    {shape === 'Anatomic' && <circle cx="10" cy="10" r="1.3" fill={color} />}
  </svg>
);

LandmarkShape.propTypes = { shape: PropTypes.string, color: PropTypes.string, size: PropTypes.number };


/** A landmark's type, set as an outlined mark so that it never reads as a name */
const LandmarkTypeMark = ({ text }) => <span className="landmarkTypeMark" data-cy="landmark-type-mark">{text}</span>;

LandmarkTypeMark.propTypes = { text: PropTypes.string.isRequired };


/**
 * The dot of a landmark that sets a colour itself: one colour for Line, split for Line and Text, the
 * left half empty for Text only. The name is never tinted.
 */
const OwnColorDot = ({ line, text, label }) => {
  const background = line && text ? `linear-gradient(90deg, ${line} 50%, ${text} 50%)`
    : line ? line : `linear-gradient(90deg, transparent 50%, ${text} 50%)`;
  return (
    <span
      className={`landmarkOwnColor ${!line ? 'isTextOnly' : ''}`}
      role="img"
      aria-label={label}
      data-cy="landmark-own-color"
      data-roles={[line && 'Line', text && 'Text'].filter(Boolean).join(' ')}
      style={{ background, ...(!line ? { borderColor: text } : {}) }}
    />
  );
};

OwnColorDot.propTypes = { line: PropTypes.string, text: PropTypes.string, label: PropTypes.string };


/** The name of an annotation-palette colour, else the colour's value */
function colorName(color) {
  const attributes = OHIF.displayAttributes || {};
  const hex = typeof attributes.normalizeHexColor === 'function' ? attributes.normalizeHexColor(color) : null;
  const named = hex && (attributes.ANNOTATION_PALETTE || []).find(entry => attributes.normalizeHexColor(entry.hex) === hex);
  return named ? named.name : (hex || String(color));
}


const ReferenceRow = ({ label, children }) => (
  <div className="detailRef">
    <span className="detailLabel">{label}</span>
    <span className="detailRefValue">{children}</span>
  </div>
);

ReferenceRow.propTypes = { label: PropTypes.node, children: PropTypes.node };


// What the Category of a set is
const CATEGORY_HELP = 'Coded concept describing the type of landmark.';

// The list shows this many entries and scrolls beyond that
const VISIBLE_ENTRIES = 8;


const LandmarkSetCard = ({ measurementData, rowNumber, series, image, heldNote, onChoose }) => {
  const { t } = useTranslation('MeasurementTable');
  const set = measurementData.landmarkSet;
  const fromApplication = Boolean(measurementData.fromApplicationDocument);
  const named = set.landmarks.filter(landmark => landmark.name);
  const unnamed = set.count - named.length;
  const countText = count => (count === 1 ? t('1 landmark') : t('{{count}} landmarks', { count }));

  // The footer of the list, and the note of a set with no named landmark: the stepping guidance on a
  // placed set only, since a held set offers no navigation
  const unnamedText = unnamed === 1 ? t('1 landmark has no name.') : t('{{count}} landmarks have no name.', { count: unnamed });
  const stepText = t('Select the row to step through all {{count}}.', { count: set.count });

  // Eight entries show whatever their height (one line, or two with a second line); the list scrolls
  // beyond that. The height is that of the first eight entries as laid out.
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const entries = [...list.children].slice(0, VISIBLE_ENTRIES);
    const height = entries.reduce((sum, entry) => sum + entry.offsetHeight, 0);
    list.style.maxHeight = list.children.length > VISIBLE_ENTRIES && height > 0 ? `${height}px` : '';
  });

  // The current landmark's entry is kept in view: when it changes, the list scrolls just far enough
  // to show it whole
  useLayoutEffect(() => {
    const list = listRef.current;
    const entry = list && list.querySelector('.landmarkEntry.isCurrent');
    if (!entry) {
      return;
    }
    // The entry's place within the list's scrolled content
    const top = entry.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + entry.offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [set.key, set.position]);

  const conceptText = set.concept && [set.concept.meaning, [set.concept.value, set.concept.scheme].filter(Boolean).join(', ')]
    .filter(Boolean).join(' · ');

  return (
    <div className="measurementDetailCardBody landmarkSetCardBody" data-cy="landmark-set-card">
      <div className="detailHeader">
        <span className="detailTile"><LandmarkSetIcon size={24} /></span>
        <div className="detailTitle">
          <div className={`detailName ${set.name ? '' : 'isUnnamed'}`}>{set.name || t('Landmark set')}</div>
          <div className="detailDescriptor">{countText(set.count)}</div>
        </div>
        <div className="detailChips">
          {rowNumber !== undefined && rowNumber !== null && <span className="detailChip">#{rowNumber}</span>}
          {fromApplication ? (
            // The lock, as on every saved set; its hover says where the set comes from. It stays out of
            // the tab order, so that Tab from the set icon reaches the list
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="detailChip" data-cy="landmark-set-card-saved">
                    <Icons.Lock aria-hidden="true" className="detailChipLock" />
                    {t('Saved')}
                    <span className="visuallyHidden">{t('Read-only: from an application document')}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="measurementApplicationDocumentNote landmarkCardTooltip" data-cy="landmark-set-card-application-document">
                  <svg aria-hidden="true" className="measurementDocumentIcon" viewBox="0 0 24 24" width="14" height="14" fill="none"
                    stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
                    <path d="M6 3h8l4 4v14H6z" />
                    <path d="M14 3v4h4M9 12h6M9 16h6" />
                  </svg>
                  <span>{t('Read-only: from an application document')}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="detailChip" data-cy="landmark-set-card-saved">
              <Icons.Lock aria-hidden="true" className="detailChipLock" />
              {t('Saved')}
            </span>
          )}
        </div>
      </div>

      {set.description && <div className="landmarkSetDescription">{set.description}</div>}

      {named.length > 0 && (
        <div className="detailSection" data-cy="landmark-set-card-landmarks">
          <div className="detailSectionHeader">
            {t('Landmarks')}
            <span>{t('{{named}} of {{count}}', { named: named.length, count: set.count })}</span>
          </div>
          <div ref={listRef} className={`landmarkEntries ${named.length > VISIBLE_ENTRIES ? 'isScrolling' : ''}`} data-cy="landmark-entries">
            {named.map((landmark) => {
              const isCurrent = set.position === landmark.index;
              const content = (
                <>
                  <span className="landmarkEntryOrdinal">{landmark.ordinal}</span>
                  <span className="landmarkEntryShape"><LandmarkShape shape={landmark.shape} color={landmark.line} /></span>
                  <span className="landmarkEntryName">
                    <span className="landmarkEntryText">{landmark.name}</span>
                    {landmark.detail && <span className="landmarkEntryDetail">{landmark.detail}</span>}
                  </span>
                  <span className="landmarkEntryColor">
                    {(landmark.own.Line || landmark.own.Text) && (
                      <OwnColorDot line={landmark.own.Line} text={landmark.own.Text} label={t('Own colour')} />
                    )}
                  </span>
                </>
              );
              const className = `landmarkEntry ${isCurrent ? 'isCurrent' : ''}`;
              return set.placed ? (
                <button
                  key={landmark.index}
                  type="button"
                  className={className}
                  aria-current={isCurrent ? 'true' : undefined}
                  data-cy="landmark-entry"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChoose(event, landmark.index);
                  }}
                >
                  {content}
                </button>
              ) : (
                <div key={landmark.index} className={className} data-cy="landmark-entry">{content}</div>
              );
            })}
          </div>
          {(unnamed > 0 || set.placed) && (
            <div className="landmarkEntriesFooter" data-cy="landmark-entries-footer">
              {[unnamed > 0 ? unnamedText : '', set.placed ? stepText : ''].filter(Boolean).join(' ')}
            </div>
          )}
        </div>
      )}

      {(conceptText || set.label) && (
        <div className="detailSection" data-cy="landmark-set-card-meta">
          <div className="detailSectionHeader">{t('Meta')}</div>
          {conceptText && (
            <ReferenceRow
              label={(
                // The label with a hover that says what the category is, in the document's terms
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="landmarkCategoryLabel" tabIndex={0} data-cy="landmark-set-card-category">{t('Category')}</span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="landmarkCategoryHelp landmarkCardTooltip" data-cy="landmark-set-card-category-help">
                      {t(CATEGORY_HELP)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            >
              {conceptText}
            </ReferenceRow>
          )}
          {set.label && <ReferenceRow label={t('Label')}>{set.label}</ReferenceRow>}
        </div>
      )}

      <div className="detailSection" data-cy="landmark-set-card-reference">
        <div className="detailSectionHeader">{t('Reference')}</div>
        <ReferenceRow label={t('Series')}>{series || t('Unknown')}</ReferenceRow>
        {image && <ReferenceRow label={t('Image')}>{image}</ReferenceRow>}
        {set.frame && <ReferenceRow label={t('Frame')}>{set.frame}</ReferenceRow>}
        <ReferenceRow label={t('Landmarks')}>
          <span className="landmarkCountLine">
            <span className="landmarkCount">{set.count}</span>
            <span className="landmarkTypes" data-cy="landmark-set-card-types">
              {set.types.map(type => (
                <span key={type.text} className="landmarkType">
                  <LandmarkShape shape={type.shape} color="currentColor" size={14} />
                  {`${type.count} ${t(type.text)}`}
                </span>
              ))}
            </span>
          </span>
        </ReferenceRow>
        <ReferenceRow label={t('Document')}>{fromApplication ? t('Application document') : t('Measurement report')}</ReferenceRow>
        {!set.placed && named.length === 0 && (
          <div className="landmarkEntriesFooter" data-cy="landmark-set-card-unnamed">{unnamedText}</div>
        )}
        {!set.placed && heldNote && <div className="detailNote" data-cy="landmark-set-card-held-note">{heldNote}</div>}
        {set.placed && named.length === 0 && (
          <div className="detailNote" data-cy="landmark-set-card-step-note">{`${t('No landmark has a name.')} ${stepText}`}</div>
        )}
      </div>

      {set.appearance && (
        <div className="detailSection" data-cy="landmark-set-card-appearance">
          <div className="detailSectionHeader">{t('Appearance')}</div>
          <ReferenceRow label={t('Line')}>
            <span className="detailSwatch" style={{ backgroundColor: set.appearance.line }} />{colorName(set.appearance.line)}
          </ReferenceRow>
          <ReferenceRow label={t('Text')}>
            <span className="detailSwatch" style={{ backgroundColor: set.appearance.text }} />{colorName(set.appearance.text)}
          </ReferenceRow>
          {set.appearance.overrides.length > 0 && (
            <ReferenceRow label={t('Overrides')}>
              <span className="landmarkTypes">
                {set.appearance.overrides.map(override => (
                  <span key={override.ordinal} className="landmarkType" data-cy="landmark-set-card-override">
                    {override.ordinal}
                    <OwnColorDot line={override.line} text={override.text} label={t('Own colour')} />
                  </span>
                ))}
              </span>
            </ReferenceRow>
          )}
        </div>
      )}
    </div>
  );
};

LandmarkSetCard.propTypes = {
  /** The set's panel row (landmarkSetRows.js) */
  measurementData: PropTypes.object.isRequired,
  rowNumber: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  /** The series line: number, description and image count */
  series: PropTypes.string,
  /** An image-domain set's image: its instance number, and its frame of a multiframe instance */
  image: PropTypes.string,
  /** The held note of a set that is not placed */
  heldNote: PropTypes.string,
  /** Choose a named landmark: (event, index) */
  onChoose: PropTypes.func.isRequired,
};


export { HeldSetMark, LandmarkSetCard, LandmarkSetIcon, LandmarkShape, LandmarkTypeMark, colorName };
export default LandmarkSetCard;
