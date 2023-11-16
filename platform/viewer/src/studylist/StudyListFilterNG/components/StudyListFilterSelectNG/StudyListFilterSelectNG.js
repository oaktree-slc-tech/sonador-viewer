import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import SelectDropdownNG from '@ohif/ui/src/components/SelectDropdownNG/SelectDropdownNG';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';
import { ReactComponent as CloseIcon } from '@ohif/ui/src/elements/Svg/svgs/close.svg';

import styles from './StudyListFilterSelectNG.module.scss';

export default function StudyListFilterSelectNG({ filter, onChangeFilterValue, selectedOptions = [] }) {
  const { t } = useTranslation(['StudyList']);

  const [isOpenSelectDropdown, setIsOpenSelectDropdown] = useState(false);

  const renderBtnContent = () => {
    if (selectedOptions.length) {
      let label = selectedOptions[0];

      if (selectedOptions.length > 1) {
        label += ` + ${selectedOptions.length - 1}`;
      }

      return (
        <>
          {label}
          <CloseIcon
            onClick={(e) => {
              e.stopPropagation();
              onChangeFilterValue((prevState) => {
                return {
                  ...prevState,
                  [filter.tag]: [],
                };
              });
            }}
          />
        </>
      );
    }

    return (
      <>
        {t(filter.label)}
        <ChevronDown className={classNames({ [styles.chevronUp]: isOpenSelectDropdown })} />
      </>
    );
  };

  const handleSelectOption = (id, event) => {
    const { checked } = event.target;

    onChangeFilterValue((prevState) => {
      const prevSelectedOptions = prevState[filter.tag] || [];

      return {
        ...prevState,
        [filter.tag]: checked ? [...prevSelectedOptions, id] : prevSelectedOptions.filter((item) => item !== id),
      };
    });
  };

  const handleReset = () => {
    if (selectedOptions.length) {
      onChangeFilterValue((prevState) => {
        return {
          ...prevState,
          [filter.tag]: [],
        };
      });
    }
  };

  const handleSelectAll = (e) => {
    const { checked } = e.target;
    onChangeFilterValue((prevState) => {
      return {
        ...prevState,
        [filter.tag]: checked ? filter.options : [],
      };
    });
  };

  return (
    <SelectDropdownNG
      isOpen={isOpenSelectDropdown}
      Button={() => (
        <button
          className={classNames(styles.studyFilterContainer, {
            [styles.active]: !!selectedOptions.length,
          })}
        >
          {renderBtnContent()}
        </button>
      )}
      onSelectAllOptions={handleSelectAll}
      setIsOpen={setIsOpenSelectDropdown}
      selectedOptions={selectedOptions}
      options={filter.options.map((option) => ({ id: option, label: option }))}
      onSelectOption={handleSelectOption}
      onClickAction={handleReset}
      title={`Select ${t(filter.label)}`}
      actionType="reset"
      isSearch
      classes={{ dropdown: styles.dropdown, container: styles.dropdownContainer }}
    />
  );
}

StudyListFilterSelectNG.propTypes = {
  filter: PropTypes.shape({
    tag: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    options: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  onChangeFilterValue: PropTypes.func.isRequired,
  selectedOptions: PropTypes.arrayOf(PropTypes.string),
};
