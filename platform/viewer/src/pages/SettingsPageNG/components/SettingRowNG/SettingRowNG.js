// The settings page's row anatomy (Settings > General, both tabs): a label column and a control
// column, every control with its help text beneath it and a hover text on the control itself, so
// the next setting is a row and not markup. The controls are @ohif/ui-next's as they ship (Switch,
// Label, Tooltip, the colour well of ColorFieldNG) in the kit's own colours; the stylesheet lays
// them out and repaints nothing but the Numeric stepper the page already repainted.

import React, { useCallback } from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Label, Switch, Tooltip, TooltipContent, TooltipTrigger } from '@ohif/ui-next';

import ColorFieldNG from '../../../../components/ColorFieldNG/ColorFieldNG';

import styles from './SettingRowNG.module.scss';

/**
 * A row: the label column and the controls under it. `top` aligns the label with the first line of
 * a control taller than one line (a switch with help text, a stepper).
 */
export default function SettingRowNG({ label, top = false, children, className }) {
  return (
    <div className={classNames(styles.row, { [styles.rowTop]: top }, className)}>
      <p className={styles.rowLabel}>{label}</p>
      <div className={styles.rowControls}>{children}</div>
    </div>
  );
}

SettingRowNG.propTypes = {
  label: PropTypes.node.isRequired,
  top: PropTypes.bool,
  children: PropTypes.node,
  className: PropTypes.string,
};

// The hover text hangs on a span around the control, not on the control itself: a Radix control
// (the Switch) and the tooltip's trigger both write `data-state`, and with `asChild` the
// trigger's open / closed would overwrite the switch's checked / unchecked, which its styling and
// tests read. Hover and focus on the control bubble to the span.
function Hint({ text, children }) {
  if (!text) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={styles.hintAnchor}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className={styles.tooltip}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

Hint.propTypes = { text: PropTypes.string, children: PropTypes.node };

/**
 * An on / off setting as the kit's Switch, the control the viewer uses for the same kind of
 * preference (the segmentation table's configuration drawer), with its label and help text. The
 * Switch is a button, so the label points at it (`htmlFor`) rather than wrapping it, and the help
 * text is its description.
 */
export function SwitchRowNG({ id, label, help, hint, checked, disabled = false, onCheckedChange }) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className={styles.control}>
      <div className={styles.controlLine}>
        <Hint text={hint}>
          <Switch
            id={id}
            checked={!!checked}
            disabled={disabled}
            aria-describedby={helpId}
            onCheckedChange={value => onCheckedChange(value === true)}
            data-cy={id}
          />
        </Hint>
        <Label htmlFor={id} className={styles.controlLabel}>
          {label}
        </Label>
      </div>
      {help && (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      )}
    </div>
  );
}

SwitchRowNG.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  help: PropTypes.string,
  hint: PropTypes.string,
  checked: PropTypes.bool,
  disabled: PropTypes.bool,
  onCheckedChange: PropTypes.func.isRequired,
};

/** A colour well (ColorFieldNG) with its label and help text. */
export function ColorRowNG({
  id, label, help, hint, disabledHint, value, disabled = false, onChange, fallback, cancelText, applyText,
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className={styles.control}>
      <div className={classNames(styles.controlLine, styles.controlLineColor)}>
        <ColorFieldNG
          id={id}
          value={value}
          onChange={onChange}
          label={label}
          hint={hint}
          disabled={disabled}
          disabledHint={disabledHint}
          fallback={fallback}
          describedBy={helpId}
          cancelText={cancelText}
          applyText={applyText}
        />
        <Label htmlFor={id} className={styles.controlLabel}>
          {label}
        </Label>
      </div>
      {help && (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      )}
    </div>
  );
}

ColorRowNG.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  help: PropTypes.string,
  hint: PropTypes.string,
  disabledHint: PropTypes.string,
  value: PropTypes.string,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  fallback: PropTypes.string,
  cancelText: PropTypes.string,
  applyText: PropTypes.string,
};

/**
 * A control that renders its own input without an id (the kit's Numeric stepper): the label wraps
 * it, so the implicit association lands on the first labelable descendant, the input, and the help
 * text is attached to that input once it is in the DOM. The forwarded ref reaches the wrapping
 * label, for a caller that binds keys to the input.
 */
export const NumericRowNG = React.forwardRef(function NumericRowNG({ id, label, help, children }, ref) {
  const helpId = help ? `${id}-help` : undefined;
  const setRefs = useCallback(
    node => {
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
      if (node && helpId) {
        node.querySelector('input')?.setAttribute('aria-describedby', helpId);
      }
    },
    [ref, helpId]
  );
  return (
    <div className={styles.control}>
      <label className={classNames(styles.controlLine, styles.numeric)} ref={setRefs}>
        {children}
        <span className={styles.controlLabel}>{label}</span>
      </label>
      {help && (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      )}
    </div>
  );
});

NumericRowNG.propTypes = {
  /** Names the help text's id */
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  help: PropTypes.string,
  children: PropTypes.node.isRequired,
};
