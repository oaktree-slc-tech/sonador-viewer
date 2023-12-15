import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import useClickOutside from '@ohif/viewer/src/hooks/useClickOutside';

import { ReactComponent as CloseIcon } from '../../elements/Svg/svgs/close.svg';
import { ReactComponent as SearchIcon } from '../../elements/Svg/svgs/search.svg';
import { useDebounce } from '../../hooks';
import CheckboxNG from '../CheckboxNG/CheckboxNG';

import styles from './SelectDropdownNG.module.scss';

export default function SelectDropdownNG({
  title,
  isSearch,
  selectedOptions,
  onSelectOption,
  options = [],
  onSelectAllOptions,
  actionType = 'reset',
  onClickAction,
  Button,
  isOpen,
  setIsOpen,
  classes = {
    dropdown: '',
    container: '',
  },
  position = 'left',
}) {
  const [search, setSearch] = useState('');
  const [filteredOptions, setFilteredOptions] = useState(options);

  const handleChangeSearch = (event) => {
    setSearch(event.target.value);
  };
  const debouncedSearch = useDebounce(search, 500);

  const callback = useCallback(() => setIsOpen(false), [setIsOpen]);

  const ref = useRef(null);
  const dropdownRef = useRef(null);
  useClickOutside([ref, dropdownRef], callback);

  useEffect(() => {
    if (debouncedSearch) {
      setFilteredOptions(options.filter(({ label }) => label.toLowerCase().includes(debouncedSearch.toLowerCase())));
    } else {
      setFilteredOptions(options);
    }
  }, [debouncedSearch, options]);

  const { top = 0, height = 0, right = 0, left = 0 } = ref.current?.getBoundingClientRect() || {};
  const { width: dropdownWidth = 0 } = dropdownRef.current?.getBoundingClientRect() || {};

  const style = {
    top: height + top + window.scrollY + 10,
  };

  if (position === 'left') {
    if (left + dropdownWidth > window.innerWidth) {
      style.left = left - (left + dropdownWidth - window.innerWidth);
    } else {
      style.left = left;
    }
  } else {
    style.right = window.innerWidth - right;
  }

  return (
    <div className={classNames(styles.selectDropdownNgContainer, classes.container)} ref={ref}>
      <div onClick={() => setIsOpen(!isOpen)} className={styles.selectDropdownNgBtn}>
        <Button />
      </div>
      {isOpen &&
        createPortal(
          <div className={classNames(styles.selectDropdownNg, classes.dropdown)} style={style} ref={dropdownRef}>
            <div className={styles.header}>
              <p className={styles.selectTitle}>{title}</p>
              <CloseIcon fill="#ffffff" onClick={() => setIsOpen(false)} className={styles.selectCloseIcon} />
            </div>
            {isSearch && (
              <div
                className={classNames(styles.searchContainer, {
                  [styles.active]: !!search,
                  [styles.marginBottom]: !!onSelectAllOptions,
                })}
              >
                <SearchIcon className={classNames({ [styles.highlightSearch]: !!search })} />
                <input
                  type="text"
                  value={search}
                  onChange={handleChangeSearch}
                  className={classNames(styles.search, {
                    [styles.active]: !!search,
                  })}
                  placeholder="Search..."
                />
              </div>
            )}
            {onSelectAllOptions && (
              <>
                <CheckboxNG
                  checked={selectedOptions.length === options.length}
                  onChange={onSelectAllOptions}
                  label="Select All"
                  id="select-all-columns"
                  indeterminate={selectedOptions.length > 0 && selectedOptions.length !== options.length}
                  classes={{ checkmark: styles.checkmark }}
                />
                <hr className={styles.selectAllDivider} />
              </>
            )}
            <div className={styles.optionsContainer}>
              {filteredOptions.map(({ id, label }) => {
                return (
                  <CheckboxNG
                    key={id}
                    checked={selectedOptions.includes(id)}
                    onChange={(e) => onSelectOption(id, e)}
                    label={label}
                    id={id}
                    classes={{ checkmark: styles.checkmark }}
                  />
                );
              })}
            </div>
            <div className={styles.action}>
              <button onClick={onClickAction} className={styles.bottomAction}>
                {actionType === 'reset' ? 'Reset' : actionType === 'submit' ? 'Submit' : ''}
              </button>
            </div>
          </div>,
          document.getElementById('body')
        )}
    </div>
  );
}

SelectDropdownNG.propTypes = {
  title: PropTypes.string,
  isSearch: PropTypes.bool,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      label: PropTypes.string,
    })
  ).isRequired,
  onSelectAllOptions: PropTypes.func,
  actionType: PropTypes.string,
  selectedOptions: PropTypes.arrayOf(PropTypes.string).isRequired,
  onSelectOption: PropTypes.func.isRequired,
  onClickAction: PropTypes.func.isRequired,
  Button: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
  classes: PropTypes.shape({
    dropdown: PropTypes.string,
    container: PropTypes.string,
  }),
  position: PropTypes.oneOf(['left', 'right']),
};
