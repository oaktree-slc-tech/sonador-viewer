import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Icon } from './../elements/Icon';

import './toolbar-button.styl';


// A toolbar control operable by pointer and keyboard: a tab stop named by its translated label,
// activated once per press as a native button is (Enter on keydown, Space on keyup). `isToggle`
// exposes the active state as aria-pressed; an expandable button exposes its menu state as
// aria-expanded. `presentational` drops the control semantics for a button inside a wrapper that
// is itself the focusable control. `domId` is the element's id.
export function ToolbarButton({ isActive = false, className = 'toolbar-button', label = '', icon, iconWhenActive, labelWhenActive, onClick, isExpandable, isExpanded, id, isToggle = false, domId, presentational = false }) {
  const { t } = useTranslation('Buttons');

  // Determine icon display properties
  let iconProps;
  if (isActive && iconWhenActive) {
    iconProps = typeof iconWhenActive === 'string' ? { name: iconWhenActive } : iconWhenActive;
  } else {
    iconProps = typeof icon === 'string' ? { name: icon } : icon;
  }

  // Icon label
  const displayLabel = isActive && labelWhenActive ? labelWhenActive : label;

  const handleClick = (event) => {
    if (onClick) {
      onClick(event, { isActive, className, label, icon, iconWhenActive, labelWhenActive, onClick, isExpandable, isExpanded, id });
    }
  };

  const isSpace = event => event.key === ' ' || event.key === 'Spacebar';
  const handleKeyDown = (event) => {
    // A held key repeats keydown: one activation per press
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) {
        handleClick(event);
      }
    } else if (isSpace(event)) {
      event.preventDefault();
    }
  };
  const handleKeyUp = (event) => {
    if (isSpace(event)) {
      event.preventDefault();
      handleClick(event);
    }
  };

  const control = presentational ? {} : {
    role: 'button',
    tabIndex: 0,
    'aria-label': t(displayLabel),
    'aria-pressed': isToggle ? Boolean(isActive) : undefined,
    'aria-haspopup': isExpandable ? 'true' : undefined,
    'aria-expanded': isExpandable ? Boolean(isExpanded) : undefined,
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp,
  };

  return (
    <div
      id={domId}
      className={classNames(className, { active: isActive })}
      onClick={handleClick}
      data-cy={label.toLowerCase()}
      {...control}
    >
      {iconProps && <Icon {...iconProps} />}
      <div className="toolbar-button-label">
        {t(displayLabel)}
        {isExpandable && <Icon name={isExpanded ? 'caret-up' : 'caret-down'} className="expand-caret" />}
      </div>
    </div>
  );
}


ToolbarButton.displayName = 'ToolbarButton';

ToolbarButton.propTypes = {
  id: PropTypes.string,
  isActive: PropTypes.bool,
  
  /** Display label for button. Defaults to '' in the signature, so it is not required. */
  label: PropTypes.string,
  
  /** Alternative text to show when button is active */
  labelWhenActive: PropTypes.string,
  /** Defaults to 'toolbar-button' in the signature, so it is not required. Default parameters are
   *  applied inside the function and are invisible to propTypes, which validates what the caller
   *  passed -- marking these required warned on every render that relied on the default. */
  className: PropTypes.string,
  icon: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({
      name: PropTypes.string.isRequired,
    }),
  ]),
  iconWhenActive: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({
      name: PropTypes.string.isRequired,
    }),
  ]),
  onClick: PropTypes.func,
  
  /** Determines if we show expandable 'caret' symbol */
  isExpandable: PropTypes.bool,
  
  /** Direction of expandable 'caret' symbol */
  isExpanded: PropTypes.bool,

  /** An on/off control: the active state is exposed as aria-pressed */
  isToggle: PropTypes.bool,

  /** id of the button element */
  domId: PropTypes.string,

  /** Rendered inside a wrapper that is the focusable control: no role, tab stop or key handling */
  presentational: PropTypes.bool,
};



export default ToolbarButton;
