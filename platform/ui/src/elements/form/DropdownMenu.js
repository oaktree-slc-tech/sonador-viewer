import React, { useCallback, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import useClickOutside from '@ohif/viewer/src/hooks/useClickOutside';

import { Icon } from '../Icon';

import './DropdownMenu.css';

function DropdownMenu({ list, align, titleElement, title }) {
  const [open, setOpen] = useState(false);

  const ref = useRef(null);

  const handleOnClick = (onClick) => {
    setOpen(false);

    if (onClick) {
      onClick();
    }
  };

  const callback = useCallback(() => setOpen(false), [setOpen]);
  useClickOutside(ref, callback);

  return (
    <div className="dd-menu" data-cy="options-menu" ref={ref}>
      <div className="dd-menu-toggle" onClick={() => setOpen((prevState) => !prevState)}>
        {titleElement || (
          <>
            <span className="dd-title">{title}</span>
            <span className="dd-caret-down" />
          </>
        )}
      </div>

      {open && (
        <div className={`dd-menu-list ${align || 'left'}`}>
          {list.map(({ icon, title, link, onClick, IconComponent }, key) => {
            if (link) {
              return (
                <a href={link || '#'} key={key} className="dd-item" onClick={() => handleOnClick(onClick)}>
                  {icon && <Icon {...icon} className="dd-item-icon" />}
                  <span>{title}</span>
                </a>
              );
            }

            return (
              <button key={key} className="dd-item" data-cy="dd-item-menu" onClick={() => handleOnClick(onClick)}>
                {IconComponent && <IconComponent />}
                {icon && <Icon {...icon} className="dd-item-icon" />}
                <span>{title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

DropdownMenu.propTypes = {
  titleElement: PropTypes.node,
  title: PropTypes.string,
  align: PropTypes.oneOf(['left', 'center', 'right']),
  /** Items to render in the select's drop down */
  list: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      icon: PropTypes.object,
      onClick: PropTypes.func,
      link: PropTypes.string,
    })
  ),
};

export { DropdownMenu };
