// The Annotations drawer's search and visibility row: the search box (the Tag Browser's
// InputFilter) and, at the right, the all-annotations visibility toggle, the same control as the
// Segmentations panel's all-segments toggle (ui-next SegmentationTable AddSegmentRow).
//
// The toggle's icon gives the state: the Hide icon while every listed annotation is shown, the
// Show icon (blue) while any is hidden. Clicking hides them unless all are already hidden, then
// shows them all, in every view. Without a search it acts on every annotation
// (MeasurementApi.setAllMeasurementsVisibility); while a search is active, on the matching ones
// only. Its help tag names the action, and while only some are hidden also the state, since the
// icon then marks the state, not the action.

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { Button, Icons, InputFilter, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import './VisibilityToggle.styl';

// The search runs once typing pauses for this long; the box shows each key at once
const SEARCH_DEBOUNCE_MS = 300;

/** The table rows of the panel's measurement groups */
const rowsOf = measurementCollection => (measurementCollection || [])
  .flatMap(group => (group && group.measurements) || []);

/** Whether every annotation of the panel is shown */
function allAnnotationsVisible(measurementCollection) {
  return rowsOf(measurementCollection).every(row => row && row.isVisible !== false);
}

/** Whether every annotation of the panel is hidden */
function allAnnotationsHidden(measurementCollection) {
  return rowsOf(measurementCollection).every(row => row && row.isVisible === false);
}

/**
 * The toggle's help tag: its action as a title, and the state while only some are hidden.
 * `matching` is the number of matching annotations while a search is active.
 */
function toggleHelp(t, { allVisible, allHidden, matching }) {
  const action = allHidden ? 'Show' : 'Hide';
  const title = matching === undefined
    ? t(`${action} All Annotations`)
    : t(`${action} {{count}} Matching Annotations`, { count: matching });
  const someHidden = !allVisible && !allHidden;
  const state = someHidden
    ? (matching === undefined ? t('Some annotations are hidden.') : t('Some matching annotations are hidden.'))
    : undefined;
  return { title, state, label: state ? `${state} ${title}` : title };
}

function AnnotationsVisibilityRow({ measurementCollection, onToggleAllVisibility, onQueryChange, query = '', searching = false }) {
  const { t } = useTranslation('MeasurementTable');
  const rows = rowsOf(measurementCollection);

  const allVisible = allAnnotationsVisible(measurementCollection);
  const allHidden = allAnnotationsHidden(measurementCollection);
  const help = toggleHelp(t, { allVisible, allHidden, matching: searching ? rows.length : undefined });

  return (
    <div className="measurementTableVisibilityRow">
      {/* The box keeps its own text (InputFilter uncontrolled), so typing is not held up by the
          panel's re-render; the panel hears the text once typing pauses. The box starts from the
          search in effect, so it shows that search again when the section is reopened */}
      <InputFilter
        className="annotationsSearch text-muted-foreground"
        defaultValue={query}
        onChange={onQueryChange}
        debounceTime={SEARCH_DEBOUNCE_MS}
      >
        <InputFilter.SearchIcon />
        <InputFilter.Input
          placeholder={t('Search annotations')}
          aria-label={t('Search annotations')}
          className="pl-9 pr-9"
          data-cy="annotations-search"
        />
        <InputFilter.ClearButton className="text-primary mr-0.5 p-0.5" />
      </InputFilter>
      {rows.length > 0 && (
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="annotationVisibilityToggle allAnnotations"
                data-cy="all-annotations-visibility-toggle"
                aria-label={help.label}
                onClick={() => onToggleAllVisibility(allHidden)}
              >
                {allVisible ? <Icons.Hide /> : <Icons.Show />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" data-cy="all-annotations-visibility-tooltip">
              <div>{help.title}</div>
              {help.state && <div className="text-muted-foreground mt-0.5">{help.state}</div>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

AnnotationsVisibilityRow.propTypes = {
  measurementCollection: PropTypes.array,
  /** Called with the visibility to give every listed annotation */
  onToggleAllVisibility: PropTypes.func.isRequired,
  /** Called with the search text once typing pauses */
  onQueryChange: PropTypes.func,
  /** The search in effect, which the box starts from */
  query: PropTypes.string,
  /** Whether a search is active (the listed annotations are the matching ones) */
  searching: PropTypes.bool,
};


export default AnnotationsVisibilityRow;
export { AnnotationsVisibilityRow, allAnnotationsVisible, allAnnotationsHidden, SEARCH_DEBOUNCE_MS, toggleHelp };
