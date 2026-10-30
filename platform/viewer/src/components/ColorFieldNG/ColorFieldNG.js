// A colour well for the viewer's settings forms: the Settings page's round swatch (the same 22px
// circle in the page's outline grey that the colour inputs on this page always had), which opens
// the colour picker the Study Viewer uses (react-color's ChromePicker, as in extensions/cornerstone's
// colorPickerDialog and upstream OHIF v3) in a kit Popover anchored to it, with the NG dialogs'
// Cancel / Apply action row under it. Nothing reaches the caller until Apply: Cancel, Escape and a
// click outside close the picker and leave the value alone.
//
// The value is always '#rrggbb' in lower case, which is what UserPreferencesService accepts
// (alpha is disabled so no '#rrggbbaa' can be produced).

import React, { useState } from 'react';
import { ChromePicker } from 'react-color';
import PropTypes from 'prop-types';

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ohif/ui-next';

import actionRow from '../../styles/actionRow.module.scss';
import styles from './ColorFieldNG.module.scss';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** `value` as the lower-case '#rrggbb' the field works in, or `fallback` when it is not one. */
export const normalizeHexColor = (value, fallback) =>
  (typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback);

export default function ColorFieldNG({
  id,
  value,
  onChange,
  label,
  hint,
  disabled = false,
  disabledHint,
  fallback = '#8f8f8f',
  describedBy,
  cancelText = 'Cancel',
  applyText = 'Apply',
}) {
  const [open, setOpen] = useState(false);
  // The hover text's own state, held here so it can be kept shut while the picker is open: the
  // picker is portalled, but React bubbles focus from it through the tree to the tooltip's
  // trigger, which would open the text over the picker and take the first Escape for itself.
  const [hintOpen, setHintOpen] = useState(false);
  const shown = disabled ? fallback : normalizeHexColor(value, fallback);
  // The colour the picker shows while it is open; the field's value until Apply
  const [pending, setPending] = useState(shown);

  const handleOpenChange = next => {
    if (next) {
      setPending(shown);
    }
    setOpen(next);
  };

  const cancel = () => setOpen(false);

  const apply = () => {
    setOpen(false);
    onChange(pending);
  };

  const field = (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {/* The page's own swatch (ColorFieldNG.module.scss), not a kit button: a round colour
            well is a form control this page already had a look for. */}
        <button
          type="button"
          id={id}
          className={styles.swatch}
          disabled={disabled}
          aria-label={`${label}: ${shown}`}
          aria-describedby={describedBy}
          data-cy={`${id}-swatch`}
        >
          <span className={styles.fill} style={{ backgroundColor: shown }} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {/* Portalled: the settings Layout clips its content, and the picker is taller than a row */}
      <PopoverPortal>
        <PopoverContent align="start" sideOffset={6} collisionPadding={16} aria-label={label} className={styles.popover} data-cy={`${id}-picker`}>
          {/* The Study Viewer's picker width */}
          <ChromePicker disableAlpha width={300} color={pending} onChange={color => setPending(color.hex.toLowerCase())} />
          {/* The NG dialogs' action row (styles/actionRow.module.scss): grey cancel, Primary Blue
              confirm, right-aligned, as the Viewer Metadata editor and the display attributes
              dialog draw theirs */}
          <div className={`${actionRow.actions} ${styles.footer}`}>
            <button type="button" className={actionRow.cancel} onClick={cancel} data-cy={`${id}-cancel`}>
              {cancelText}
            </button>
            <button type="button" className={actionRow.confirm} onClick={apply} data-cy={`${id}-apply`}>
              {applyText}
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );

  const text = disabled ? disabledHint : hint;
  if (!text) {
    return field;
  }

  // The hover text hangs on a span around the trigger, so it still shows while the trigger is
  // disabled (a disabled button receives no pointer events; the stylesheet lets them through to
  // the span). Focus on the button bubbles to the span, so the keyboard gets the text too.
  return (
    <Tooltip open={hintOpen && !open} onOpenChange={setHintOpen}>
      <TooltipTrigger asChild>
        <span className={styles.anchor}>{field}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className={styles.tooltip}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

ColorFieldNG.propTypes = {
  /** Also the id of the trigger, for a `Label htmlFor` */
  id: PropTypes.string.isRequired,
  /** '#rrggbb' */
  value: PropTypes.string,
  /** Called with the applied '#rrggbb' (lower case) */
  onChange: PropTypes.func.isRequired,
  /** What the colour is, for the trigger's accessible name */
  label: PropTypes.string.isRequired,
  /** Hover text while the field is enabled */
  hint: PropTypes.string,
  disabled: PropTypes.bool,
  /** Hover text while the field is disabled: why, and what enables it */
  disabledHint: PropTypes.string,
  /** The swatch while disabled, or while `value` is not a colour */
  fallback: PropTypes.string,
  /** id of the help text, for aria-describedby */
  describedBy: PropTypes.string,
  cancelText: PropTypes.string,
  applyText: PropTypes.string,
};
