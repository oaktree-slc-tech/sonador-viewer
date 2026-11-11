// Editor for the color display attributes of a resource (Series Tag `Meta.DisplayAttributes.Color`).
// Each color role offers the tool defaults, a palette of theme colors, and a custom color picker.
// An unset role follows the defaults.

import React, { useState } from 'react';
import { ChromePicker } from 'react-color';
import _ from 'lodash';
import { Pipette, X } from 'lucide-react';
import PropTypes from 'prop-types';

import { displayAttributes } from '@ohif/core';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ohif/ui-next';

import styles from './DisplayAttributesDialog.module.scss';

const { SERIES_TAG_COLOR_ROLES, SERIES_TAG_DEFAULT_COLOR, normalizeColor, normalizeHexColor, resolveDisplayColor } = displayAttributes;


// The annotation palette's theme colors (shared with the measurement colors, @ohif/core)
export const THEME_PALETTE = displayAttributes.ANNOTATION_THEME_COLORS;

const ROLE_LABELS = { Background: 'Background', Border: 'Border', Value: 'Value Text', Meaning: 'Meaning Text' };


export function paletteFor(defaults) {
  // The annotation palette (built-in defaults, then theme colors) with the site defaults that
  // differ from the built-in ones after the built-in defaults
  const builtInDefaults = displayAttributes.ANNOTATION_PALETTE.filter(swatch => !THEME_PALETTE.includes(swatch));
  const siteSwatches = SERIES_TAG_COLOR_ROLES.filter(role => defaults[role] && defaults[role] !== SERIES_TAG_DEFAULT_COLOR[role])
    .map(role => ({ name: `Site ${ROLE_LABELS[role]}`, hex: defaults[role] }));
  return _.uniqBy([...builtInDefaults, ...siteSwatches, ...THEME_PALETTE], 'hex');
}


function IconAction({ label, onClick, disabled = false, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={styles.iconButton} aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className={styles.tooltipContent}>{label}</TooltipContent>
    </Tooltip>
  );
}


IconAction.propTypes = {
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  children: PropTypes.node.isRequired,
};


function ColorRole({ role, value, effective, palette, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const active = value || effective;

  return (
    <div className={styles.role} data-cy={`display-color-${role}`}>
      <div className={styles.roleHeader}>
        <span className={styles.roleLabel}>{ROLE_LABELS[role]}</span>
        <span className={styles.roleValue}>
          <span className={`${styles.activeSwatch} ${active ? '' : styles.swatchNone}`}
            style={active ? { backgroundColor: active } : undefined} aria-hidden="true" />
          {value || (effective ? `Default (${effective})` : 'Default (none)')}
        </span>
      </div>

      <div className={styles.swatches}>
        {palette.map(({ name, hex }) => (
          <button key={hex} type="button" title={`${name} ${hex}`} aria-label={`${ROLE_LABELS[role]}: ${name}`}
            className={`${styles.swatch} ${value === hex ? styles.swatchSelected : ''}`}
            style={{ backgroundColor: hex }} onClick={() => onChange(hex)} />
        ))}
        <IconAction label={pickerOpen ? 'Hide color picker' : 'Select custom color…'} onClick={() => setPickerOpen(open => !open)}>
          <Pipette size={16} />
        </IconAction>
        <IconAction label="Reset" disabled={!value} onClick={() => onChange(null)}>
          <X size={16} />
        </IconAction>
      </div>

      {pickerOpen && (
        <div className={styles.picker}>
          <ChromePicker disableAlpha color={value || effective || '#FFFFFF'}
            onChange={color => onChange(normalizeHexColor(color.hex))} />
        </div>
      )}
    </div>
  );
}


ColorRole.propTypes = {
  role: PropTypes.oneOf(SERIES_TAG_COLOR_ROLES).isRequired,
  value: PropTypes.string,
  effective: PropTypes.string,
  palette: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string, hex: PropTypes.string })).isRequired,
  onChange: PropTypes.func.isRequired,
};


export default function DisplayAttributesDialog({ isOpen, title, tool, color, preview, onApply, onClose }) {
  // Initialized once: the dialog is mounted for a single edit
  const [draft, setDraft] = useState(() => normalizeColor(color));

  const defaults = resolveDisplayColor(tool);
  const resolved = resolveDisplayColor(tool, draft);
  const palette = paletteFor(defaults);

  // Unset roles show what the defaults (and, for Meaning, the value color) resolve to
  const effectiveFor = role => resolveDisplayColor(tool, _.omit(draft, role))[role];

  const setRole = (role, hex) => setDraft(prev => {
    const next = { ...prev };
    if (hex) next[role] = hex;
    else delete next[role];
    return next;
  });

  return (
    <ModalNG isOpen={isOpen} onClose={onClose} title={title || 'Edit Display Attributes'}>
      <TooltipProvider delayDuration={200}>
      <div className={styles.dialog}>
        <div className={styles.preview} aria-label="Preview">
          <span className={styles.previewTag} style={{ backgroundColor: resolved.Background || 'transparent', borderColor: resolved.Border }}>
            <span style={{ color: resolved.Value }}>{preview?.value || 'Value'}</span>
            <span style={{ color: resolved.Meaning }}>{preview?.meaning || 'Meaning'}</span>
          </span>
        </div>

        {SERIES_TAG_COLOR_ROLES.map(role => (
          <ColorRole key={role} role={role} value={draft[role]} effective={effectiveFor(role)}
            palette={palette} onChange={hex => setRole(role, hex)} />
        ))}

        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.apply} onClick={() => onApply(_.isEmpty(draft) ? null : draft)}>
            Apply
          </button>
        </div>
      </div>
      </TooltipProvider>
    </ModalNG>
  );
}


DisplayAttributesDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  title: PropTypes.string,
  tool: PropTypes.string,
  color: PropTypes.object,
  preview: PropTypes.shape({ value: PropTypes.string, meaning: PropTypes.string }),
  onApply: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

DisplayAttributesDialog.defaultProps = {
  tool: displayAttributes.SERIES_TAG_TOOL,
};
