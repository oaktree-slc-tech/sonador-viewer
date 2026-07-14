import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import './CustomSelect.css';

export default function CustomSelect({ value = {}, options = [] }) {
  const [isOpen, setIsOpen] = useState(false);

  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!ref.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  return (
    <div className="customSelect" ref={ref}>
      <div
        onClick={() => setIsOpen((prevState) => !prevState)}
        className={`customSelectControl ${value?.description ? 'withDescription' : ''}`}
      >
        <div className="customSelectControlTextContainer">
          <p className="customSelectOptionTitle">{value?.title}</p>
          {value?.description && <p className="customSelectOptionDescription">{value.description}</p>}
        </div>
        <div className="customSelectChevronWrapper">
          <svg height="20" width="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="#fff">
            <path d="M4.516 7.548c0.436-0.446 1.043-0.481 1.576 0l3.908 3.747 3.908-3.747c0.533-0.481 1.141-0.446 1.574 0 0.436 0.445 0.408 1.197 0 1.615-0.406 0.418-4.695 4.502-4.695 4.502-0.217 0.223-0.502 0.335-0.787 0.335s-0.57-0.112-0.789-0.335c0 0-4.287-4.084-4.695-4.502s-0.436-1.17 0-1.615z" />
          </svg>
        </div>
      </div>
      {isOpen && (
        <ul className="customSelectMenu">
          {options.map(({ title, description, value: optionValue, onClick }) => {
            const isActive = optionValue === value.value;

            return (
              <li
                key={title}
                className={`customSelectOption ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onClick && onClick();
                  setIsOpen(false);
                }}
              >
                <p className="customSelectOptionTitle">{title}</p>
                {description && <p className="customSelectOptionDescription">{description}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

CustomSelect.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      title: PropTypes.string.isRequired,
      onClick: PropTypes.func.isRequired,
      description: PropTypes.string,
    })
  ).isRequired,
  value: PropTypes.shape({
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
  }),
};
