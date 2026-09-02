import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Icon } from './../elements/Icon';

import './toolbar-button.styl';


export function ToolbarButton({ isActive = false, className = 'toolbar-button', label = '', icon, iconWhenActive, labelWhenActive, onClick, isExpandable, isExpanded, id }) {
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

  return (
    <div
      className={classNames(className, { active: isActive })}
      onClick={handleClick}
      data-cy={label.toLowerCase()}
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
};



export default ToolbarButton;
