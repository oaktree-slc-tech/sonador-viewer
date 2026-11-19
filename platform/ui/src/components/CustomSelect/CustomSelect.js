import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import './CustomSelect.css';

// A dropdown select: the shown value (title and description) and a menu of entries. It is operated
// with the pointer or the keyboard: the control takes focus; Enter, Space and the arrow keys open
// the menu; the arrow keys move through the entries, which the control names to assistive
// technology through aria-activedescendant while it keeps focus; Enter or Space chooses the
// highlighted entry; Escape and Tab close the menu, Escape returning focus to the control. The menu
// is bounded by the space visible around the control, the intersection of the viewport with every
// ancestor that clips or scrolls its content: it opens below the control into that space, or above
// it when more room is there, never taller than the room, and scrolls within it, so every entry
// stays reachable; the bound is measured again when the window is resized.

// Space kept between the menu and the edge of the visible area, and the height below the control
// under which the menu opens above it when more room is there
const MENU_MARGIN = 8;
const MENU_PREFERRED_HEIGHT = 104;

let instances = 0;

const CLIPPING = ['hidden', 'auto', 'scroll', 'clip'];

/** The visible area around an element: the viewport, cut by every ancestor that clips or scrolls */
function visibleBounds(element) {
  let top = 0;
  let bottom = window.innerHeight;
  let ancestor = element && element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const style = window.getComputedStyle(ancestor);
    if (CLIPPING.includes(style.overflowY || style.overflow)) {
      const rect = ancestor.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    ancestor = ancestor.parentElement;
  }
  return { top, bottom };
}

/**
 * Where the menu opens and how tall it may be: { above, maxHeight }. Below the control when the room
 * there holds the preferred height or is the larger side; above otherwise. Never taller than the room.
 */
function menuPlacement(control, bounds) {
  const rect = control.getBoundingClientRect();
  const below = bounds.bottom - rect.bottom - MENU_MARGIN;
  const aboveRoom = rect.top - bounds.top - MENU_MARGIN;
  const above = below < MENU_PREFERRED_HEIGHT && aboveRoom > below;
  return { above, maxHeight: Math.max(0, Math.floor(above ? aboveRoom : below)) };
}

export default function CustomSelect({ value = {}, options = [], label }) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [placement, setPlacement] = useState({ above: false, maxHeight: undefined });

  const ref = useRef(null);
  const controlRef = useRef(null);
  const menuRef = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) {
    instances += 1;
    idRef.current = `customSelect-${instances}`;
  }
  const listboxId = `${idRef.current}-listbox`;
  const optionId = index => `${idRef.current}-option-${index}`;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!ref.current?.contains(event.target)) {
        setIsOpen(false);
        setHighlighted(-1);
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  // The menu takes the room visible below (or above) the control, and scrolls within it; measured
  // again when the window is resized while it is open
  useLayoutEffect(() => {
    if (!isOpen || !controlRef.current) {
      return undefined;
    }
    const measure = () => setPlacement(menuPlacement(controlRef.current, visibleBounds(ref.current)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen, options.length]);

  // The highlighted entry stays in view while the keyboard moves through a scrolling menu
  useEffect(() => {
    if (!isOpen || highlighted < 0 || !menuRef.current) {
      return;
    }
    const entry = menuRef.current.querySelector(`[id="${optionId(highlighted)}"]`);
    if (entry && typeof entry.scrollIntoView === 'function') {
      entry.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, highlighted]);

  const selectedIndex = options.findIndex(option => option.value === value?.value);

  const open = (index = selectedIndex) => {
    setHighlighted(index >= 0 ? index : 0);
    setIsOpen(true);
  };

  const close = ({ focusControl = false } = {}) => {
    setIsOpen(false);
    setHighlighted(-1);
    if (focusControl && controlRef.current) {
      controlRef.current.focus();
    }
  };

  const choose = (option) => {
    option.onClick && option.onClick();
    close({ focusControl: true });
  };

  const moveHighlight = (step) => {
    if (!options.length) {
      return;
    }
    const from = highlighted >= 0 ? highlighted : selectedIndex;
    setHighlighted((from + step + options.length) % options.length);
  };

  const onKeyDown = (event) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!isOpen) {
          open();
        } else if (options[highlighted]) {
          choose(options[highlighted]);
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          open();
        } else {
          moveHighlight(1);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) {
          open();
        } else {
          moveHighlight(-1);
        }
        break;
      case 'Home':
        if (isOpen && options.length) {
          event.preventDefault();
          setHighlighted(0);
        }
        break;
      case 'End':
        if (isOpen && options.length) {
          event.preventDefault();
          setHighlighted(options.length - 1);
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          close({ focusControl: true });
        }
        break;
      case 'Tab':
        if (isOpen) {
          close();
        }
        break;
      default:
    }
  };

  const activeDescendant = isOpen && options[highlighted] ? optionId(highlighted) : undefined;

  return (
    <div className="customSelect" ref={ref} onKeyDown={onKeyDown}>
      <div
        ref={controlRef}
        role="combobox"
        tabIndex={0}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        onClick={() => (isOpen ? close() : open())}
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
        <ul
          className={`customSelectMenu ${placement.above ? 'customSelectMenuAbove' : ''}`}
          ref={menuRef}
          role="listbox"
          id={listboxId}
          aria-label={label}
          style={placement.maxHeight === undefined ? undefined : { maxHeight: `${placement.maxHeight}px` }}
        >
          {options.map((option, index) => {
            const { title, description, value: optionValue } = option;
            const isActive = optionValue === value?.value;
            const isHighlighted = index === highlighted;

            return (
              <li
                key={`${optionValue}-${index}`}
                id={optionId(index)}
                role="option"
                aria-selected={isActive}
                className={`customSelectOption ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(option)}
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
  /** The accessible name of the control */
  label: PropTypes.string,
};
