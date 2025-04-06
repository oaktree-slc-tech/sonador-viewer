import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Icon } from './../elements/Icon';

import './toolbar-button.styl';


export function ToolbarButton(props) {
  const { t } = useTranslation('Buttons');

  const { isActive, icon, iconWhenActive, labelWhenActive, onClick } = props;

  // Determine icon display properties
  let iconProps;
  if (isActive && iconWhenActive) {
    iconProps = typeof iconWhenActive === 'string' ? { name: iconWhenActive } : iconWhenActive;
  } else {
    iconProps = typeof icon === 'string' ? { name: icon } : icon;
  }

  // Icon label
  const label = isActive && labelWhenActive ? labelWhenActive : props.label;

  const handleClick = (event) => {
    if (onClick) {
      onClick(event, props);
    }
  };

  return (
    <div
      className={classNames(props.className, { active: isActive })}
      onClick={handleClick}
      data-cy={props.label.toLowerCase()}
    >
      {iconProps && <Icon {...iconProps} />}
      <div className="toolbar-button-label">
        {t(label)}
        {props.isExpandable && <Icon name={props.isExpanded ? 'caret-up' : 'caret-down'} className="expand-caret" />}
      </div>
    </div>
  );
}


ToolbarButton.propTypes = {
  id: PropTypes.string,
  isActive: PropTypes.bool,
  
  /** Display label for button */
  label: PropTypes.string.isRequired,
  
  /** Alternative text to show when button is active */
  labelWhenActive: PropTypes.string,
  className: PropTypes.string.isRequired,
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

ToolbarButton.defaultProps = {
  isActive: false,
  className: 'toolbar-button',
  label: '',
};


export default ToolbarButton;
