import React, { useState } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import classNames from 'classnames';

import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';

import { ReactComponent as SearchIcon } from '../../elements/Svg/svgs/search.svg';
import CheckboxNG from '../CheckboxNG/CheckboxNG';

import styles from './Autocomplete.module.scss';

function Autocomplete({
                                       title,
                                       selectedOptions,
                                       options,
                                       onSelectOption,
                                       classes = {
                                         dropdown: '',
                                         container: '',
                                       },
                                     }) {

  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filteredOptions = options.filter(option =>
    option.label?.toLowerCase().includes(search.toLowerCase()),
  );
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(10), flip({ fallbackAxisSideDirection: 'end' }), shift()],
    whileElementsMounted: autoUpdate,
    placement: 'bottom-start',
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  const handleChangeSearch = (event) => {
    setSearch(event.target.value);
  };

  const renderBtnContent = () => {
    if (selectedOptions.length) {
      const selected = options.filter(option=>selectedOptions.includes(option.value)).map(option=>option.label)

      const label = selected?.join(", ")
      return (
        <>
          {label}
          <CloseIcon
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false)
            }}
          />
        </>
      );
    }
    return (
      <>
        {title}
        <ChevronDown className={classNames({ [styles.chevronUp]: isOpen })} />
      </>
    );
  };

  return (
    <div className={classNames(styles.selectDropdownNgContainer, classes.container)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={styles.selectDropdownNgBtn}
        ref={refs.setReference}
        {...getReferenceProps()}
      >
        <div
          className={classNames(styles.studyFilterContainer, {
            [styles.active]: !!selectedOptions.length,
          })}
        >
          {renderBtnContent()}
        </div>
      </button>
      {isOpen && (
        <FloatingPortal root={document.getElementById('root')}>
          <div
            className={classNames(styles.selectDropdownNg, classes.dropdown)}
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className={styles.header}>
              <p className={styles.selectTitle}>{title}</p>
              <CloseIcon fill="#ffffff" onClick={() => setIsOpen(false)} className={styles.selectCloseIcon} />
            </div>
            <div
              className={classNames(styles.searchContainer, {
                [styles.active]: !!search,
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
            <div className={styles.optionsContainer}>
              {filteredOptions.map(({ value, label }) => {
                const isSelected = selectedOptions.includes(value);
                return (
                  <CheckboxNG
                    key={value}
                    checked={isSelected}
                    onChange={(e) => {
                      return onSelectOption(isSelected ? undefined : value);
                    }}
                    label={label}
                    id={value}
                    classes={{ checkmark: styles.checkmark }}
                  />
                );
              })}
            </div>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

Autocomplete.displayName = 'Autocomplete';

export default Autocomplete;
