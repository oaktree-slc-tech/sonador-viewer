import React, { useContext, useMemo, useState } from 'react';
import { isInclusivelyBeforeDay } from 'react-dates';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { flatten } from 'lodash';
import moment from 'moment';
import PropTypes from 'prop-types';
import qs from 'query-string';

import SelectDropdownNG from '@ohif/ui/src/components/SelectDropdownNG/SelectDropdownNG';
import DateRangePickerNG from '@ohif/ui/src/components/studyList/DateRangePickerNG';
import { ReactComponent as FiltersIcon } from '@ohif/ui/src/elements/Svg/svgs/filters.svg';
import { ReactComponent as RefreshIcon } from '@ohif/ui/src/elements/Svg/svgs/refresh.svg';
import { ReactComponent as RefreshOneArrowIcon } from '@ohif/ui/src/elements/Svg/svgs/refreshOneArrow.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';
import ImageServerPickerNG from '@ohif/viewer/src/components/ImageServerPickerNG/ImageServerPickerNG';
import AppContext from '@ohif/viewer/src/context/AppContext';
import { useDeviceStore } from '@ohif/viewer/src/store/useDeviceStore';

import useTags from '../../../../../hooks/useTags';
import { DEFAULT_FILTERS, FILTER_TYPES } from '../../../../../lib/constants';
import { getDateEntryFromRange } from '../../../../../lib/utils/getDateEntryFromRange';
import { useStudiesTableFiltersAndColumnsStore } from '../../../../../store/useStudiesTableFiltersAndColumnsStore';
import StudyListFilterNG from '../../../StudyListFilterNG/StudyListFilterNG';

import styles from './Filters.module.scss';

export default function Filters({
  onRefresh,
  endDate,
  onChangeDates,
  startDate,
  server,
  title,
  onChangeFilterValue,
  filters,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(['StudyList', 'Header']);

  const { isDesktop, isMobile, isLarge, isTablet } = useDeviceStore();
  const { selectedFilters, setSelectedFilters } = useStudiesTableFiltersAndColumnsStore();

  const [isOpenFiltersSelect, setIsOpenFiltersSelect] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);

  const { data: filtersData = {} } = useTags({ server });

  const allTags = useMemo(() => {
    const mapped = Object.entries(filtersData).map(([, filtersObj]) => {
      return Object.values(filtersObj)
        .filter((filter) => filter.vr?.name !== 'Time') // TODO remove once time data is actual to display
        .map((filter) => {
          const type = filter.options ? 'select' : FILTER_TYPES[filter.vr?.name];
          const result = {
            tag: filter.tag,
            type,
            label: filter.label,
          };

          if (filter.options) {
            result.options = filter.options;
          }

          return result;
        });
    });

    return flatten(mapped);
  }, [filtersData]);

  const { appConfig } = useContext(AppContext);

  const today = moment();
  const defaultStartDate = getDateEntryFromRange(today, appConfig.studyListDateFilterNumDays, 'start');
  const defaultEndDate = getDateEntryFromRange(today, appConfig.studyListDateFilterNumDays, 'end');
  const { search = '' } = qs.parse(location.search.replace('?', ''));

  const handleChangeSearch = (event) => {
    navigate({
      pathname: location.pathname,
      search: event.target.value ? `search=${event.target.value}` : undefined,
    });
  };

  return (
    <>
      <div className={styles.studyListHeader}>
        <p className={styles.title}>{title}</p>
        <p className={styles.useOnly}>{t('INVESTIGATIONAL USE ONLY')}</p>
      </div>
      <div className={styles.topToolbar}>
        <div className={styles.searchContainer}>
          <SearchIcon className={classNames({ [styles.searchIconHighlighted]: !!search })} />
          <input
            type="text"
            placeholder={isDesktop ? 'Search for Patients, MRN, or Description' : 'Search'}
            className={classNames(styles.search, { [styles.active]: !!search })}
            onChange={handleChangeSearch}
            value={search}
          />
          {(isDesktop || isLarge) && <hr className={styles.divider} />}
          <DateRangePickerNG
            startDate={defaultStartDate || startDate}
            startDateId="study-start-date-ng"
            endDate={defaultEndDate || endDate}
            endDateId="study-end-date-ng"
            onDatesChange={({ startDate, endDate }) => {
              onChangeDates(startDate, endDate);
            }}
            focusedInput={focusedInput}
            onFocusChange={setFocusedInput}
            numberOfMonths={1}
            hideKeyboardShortcutsPanel
            isOutsideRange={(day) => !isInclusivelyBeforeDay(day, moment())}
            onCloseCalendar={() => setFocusedInput(null)}
            isRightAnchor={isMobile || isTablet}
            withPortal={isMobile}
          />
        </div>
        <div className={styles.serverPickerAndRefresh}>
          {isDesktop && (
            <div className={styles.serverPickerWrapper}>
              <ImageServerPickerNG />
            </div>
          )}
          <button className={styles.refresh} onClick={onRefresh}>
            {isMobile ? <RefreshOneArrowIcon /> : <RefreshIcon />}
            Refresh
          </button>
        </div>
      </div>
      <div className={styles.filters}>
        <div className={styles.emptyFilterBlock} />
        <SelectDropdownNG
          isOpen={isOpenFiltersSelect}
          setIsOpen={setIsOpenFiltersSelect}
          selectedOptions={selectedFilters}
          options={allTags.map((item) => ({
            id: item.tag,
            label: item.label,
          }))}
          onSelectOption={(id) =>
            setSelectedFilters(
              selectedFilters.includes(id) ? selectedFilters.filter((item) => item !== id) : [...selectedFilters, id]
            )
          }
          onClickAction={() => setSelectedFilters(DEFAULT_FILTERS)}
          Button={() => (
            <button className={classNames(styles.filterContainer, styles.all)}>
              <FiltersIcon />
              All Filters
            </button>
          )}
          isSearch
          title="Select Filters"
          classes={{ dropdown: styles.filterSelectionDropdown }}
        />
        {allTags
          .filter(({ tag }) => selectedFilters.includes(tag))
          .map((filter) => {
            return (
              <StudyListFilterNG
                key={filter.tag}
                filter={filter}
                filterValue={filters[filter.tag]}
                onChangeFilterValue={onChangeFilterValue}
              />
            );
          })}
      </div>
    </>
  );
}

Filters.propTypes = {
  onChangeDates: PropTypes.func.isRequired,
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  onRefresh: PropTypes.func.isRequired,
  server: PropTypes.object,
  title: PropTypes.string.isRequired,
  onChangeFilterValue: PropTypes.func.isRequired,
  filters: PropTypes.object,
};
