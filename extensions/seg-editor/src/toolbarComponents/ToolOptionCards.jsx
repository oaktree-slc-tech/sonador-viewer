import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { OPTION_UNITS } from '../toolbox/constants';
import { GENERIC_UNIT_HINT, LENGTH_UNITS, useSegEditorUnits } from '../utils/segEditorUnits';

import { Card, decimalsOf, RangeSliderRow, SegmentedRow, SliderRow } from './panelControls';


// The active palette tool's options as a card (ohif-viewers#142, §12), in place of OHIF v3's
// ToolSettings: the Labelmap tools' radius, shape and threshold settings in the row grammar of the
// 3D tools' panel. The options are the toolbar's own (each carries the `onChange` the toolbar service
// binds to its commands), so only how they are drawn changes. A tool whose options are a custom
// panel (the 3D tools) draws its own cards.

/** A range option's value, clamped to its range and given to its step's decimals. */
export function clampToRange(option, value) {
  const number = Math.min(option.max, Math.max(option.min, Number(value)));
  return option.step ? Number(number.toFixed(decimalsOf(option.step))) : number;
}

/**
 * The unit an option's value is shown in, and the hint on it.
 *
 * @param {Object} option - a toolbar option; `unit` is one of OPTION_UNITS
 * @param {{ length: string, intensity: string|null }} units - the reference series' units
 * @returns {{ unit?: string, unitHint?: string }}
 */
export function optionUnit(option, units) {
  if (option.unit === OPTION_UNITS.length) {
    return {
      unit: units.length,
      unitHint: units.length === LENGTH_UNITS.generic ? GENERIC_UNIT_HINT : undefined,
    };
  }
  if (option.unit === OPTION_UNITS.intensity && units.intensity) {
    return { unit: units.intensity, unitHint: 'Hounsfield units' };
  }
  return {};
}

function OptionRow({ option, units, t }) {
  const { unit, unitHint } = optionUnit(option, units);
  const unitProps = { unit: unit && t(unit), unitHint: unitHint && t(unitHint) };
  const id = `seg-editor-option-${option.id}`;
  switch (option.type) {
    case 'range':
      return (
        <SliderRow
          id={id}
          label={option.name}
          hint={option.tooltip}
          {...unitProps}
          value={Number(option.value)}
          range={option}
          onChange={value => option.onChange?.(clampToRange(option, value))}
        />
      );
    case 'double-range':
      return (
        <RangeSliderRow
          id={id}
          label={option.name}
          hint={option.tooltip}
          {...unitProps}
          value={option.value.map(Number)}
          range={option}
          onChange={values => option.onChange?.(values.map(value => clampToRange(option, value)))}
        />
      );
    case 'radio':
      return (
        <SegmentedRow
          id={id}
          label={option.name}
          hint={option.tooltip}
          value={option.value}
          items={option.values}
          onChange={value => option.onChange?.(value)}
        />
      );
    case 'custom':
      return typeof option.children === 'function' ? option.children() : option.children;
    default:
      return null;
  }
}

OptionRow.propTypes = {
  option: PropTypes.object.isRequired,
  units: PropTypes.object.isRequired,
  t: PropTypes.func.isRequired,
};

export default function ToolOptionCards({ title, options }) {
  const { t } = useTranslation('SegmentationEditor');
  const units = useSegEditorUnits();

  if (!Array.isArray(options) || !options.length) {
    return null;
  }
  const shown = options.filter(option => !option.condition || option.condition({ options }) !== false);
  const rows = shown.map(option => <OptionRow key={option.id} option={option} units={units} t={t} />);

  // A custom panel brings its own cards
  if (shown.every(option => option.type === 'custom')) {
    return <div className="text-foreground">{rows}</div>;
  }
  return (
    <div className="text-foreground px-1 py-1 text-[13px]" data-cy="seg-editor-tool-options">
      <Card title={title || t('Options')} dataCy="seg-editor-tool-options-card">{rows}</Card>
    </div>
  );
}

ToolOptionCards.propTypes = {
  // The active tool's label, the card's title
  title: PropTypes.string,
  // The active tool's toolbar options
  options: PropTypes.arrayOf(PropTypes.object),
};
