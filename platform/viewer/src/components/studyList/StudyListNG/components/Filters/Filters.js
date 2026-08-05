import { flatten } from 'lodash';

import React, { useContext, useMemo, useState } from 'react';
import { isInclusivelyBeforeDay } from 'react-dates';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';

import classNames from 'classnames';
import moment from 'moment';

import qs from 'query-string';

import ImageServerPickerNG from '@ohif/sonador-viewer/src/components/ImageServerPickerNG/ImageServerPickerNG';
import AppContext from '@ohif/sonador-viewer/src/context/AppContext';
import { useDeviceStore } from '@ohif/sonador-viewer/src/store/useDeviceStore';
import Autocomplete from '@ohif/ui/src/components/Autocomplete/Autocomplete';
import SelectDropdownNG from '@ohif/ui/src/components/SelectDropdownNG/SelectDropdownNG';
import DateRangePickerNG from '@ohif/ui/src/components/studyList/DateRangePickerNG';
import { ReactComponent as FiltersIcon } from '@ohif/ui/src/elements/Svg/svgs/filters.svg';
import { ReactComponent as RefreshIcon } from '@ohif/ui/src/elements/Svg/svgs/refresh.svg';
import { ReactComponent as RefreshOneArrowIcon } from '@ohif/ui/src/elements/Svg/svgs/refreshOneArrow.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';

import { Icon } from '@ohif/ui';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@ohif/ui-next';
import { DownloadManagerService, JOB_STATES } from '@ohif/core';

import UserMenu from '../../../../UserMenu/UserMenu';
import useTags from '../../../../../hooks/useTags';
import { DEFAULT_FILTERS, FILTER_TYPES } from '../../../../../lib/constants';
import { getDateEntryFromRange } from '../../../../../lib/utils/getDateEntryFromRange';
import { useWorklistContext } from '../../../../../pages/WorkListPageNG/worklist.context';
import StudyListFilterNG from '../../../StudyListFilterNG/StudyListFilterNG';
import DownloadManagerModal from '../DownloadManagerModal/DownloadManagerModal';
import useLocalCacheVersion from '../../hooks/useLocalCacheVersion';

import styles from './Filters.module.scss';


export default function Filters({
  onRefresh,
  endDate,
  studies,
  onChangeDates,
  startDate,
  title,
  onChangeFilterValue,
  filters,
  selectedFilters,
  setSelectedFilters,
  isWorklist,
}) {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(['StudyList', 'Header']);


  const { isDesktop, isMobile, isLarge, isTablet } = useDeviceStore();

  const [isOpenFiltersSelect, setIsOpenFiltersSelect] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);
  const [isDownloadManagerOpen, setIsDownloadManagerOpen] = useState(false);

  // Reactive count of in-flight downloads for the Download Manager indicator (ohif-viewers#125,
  // FR-5). Rendered on the shared StudyListNG surface, so it appears on Studies/All, Worklist, and
  // Shared alike (AR-8).
  useLocalCacheVersion();
  const activeDownloadCount = DownloadManagerService
    ? DownloadManagerService.listActiveJobs().filter(j => j.state === JOB_STATES.QUEUED || j.state === JOB_STATES.DOWNLOADING).length
    : 0;

  const { data: filtersData = {} } = useTags({ server: activeServer });

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
        <div className={styles.headerRight}>
          {/* Control order mirrors the Study Viewer header (Header.js): the Investigational Use
              notice first, then the icon controls to its right. */}
          <p className={styles.useOnly}>{t('INVESTIGATIONAL USE ONLY')}</p>

          <div className={styles.headerControls}>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={styles.downloadManager}
                    onClick={() => setIsDownloadManagerOpen(true)}
                    aria-label={t('Manage Offline Storage')}
                  >
                    <Icon name="offline-cache" />
                    {activeDownloadCount > 0 && <span className={styles.downloadBadge}>{activeDownloadCount}</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className={styles.dmTooltipContent}>
                  <div className={styles.dmTooltipTitle}>{t('Offline Storage')}</div>
                  <div className={styles.dmTooltipBody}>
                    {t('Save studies for offline viewing. Monitor active transfers. Manage local storage.')}
                    {activeDownloadCount > 0 && (
                      <div className={styles.dmTooltipCount}>
                        {activeDownloadCount}{' '}
                        {activeDownloadCount === 1 ? t('active download') : t('active downloads')}
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Account menu (ohif-viewers#31). The study list previously had no way to sign out at
                all -- Logout lived only in the viewer header. Shares its options with that header
                via UserMenu so the two cannot drift apart again. */}
            <UserMenu align="end" className={styles.userMenu} />
          </div>
        </div>
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
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={styles.refresh}
                  onClick={onRefresh}
                  aria-label={t('Refresh study list')}
                >
                  {isMobile ? <RefreshOneArrowIcon /> : <RefreshIcon />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className={styles.dmTooltipContent}>
                <div className={styles.dmTooltipBody}>
                  {t('Refresh the study list to retrieve the latest results from the server.')}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {isDownloadManagerOpen && (
        <DownloadManagerModal isOpen={isDownloadManagerOpen} onClose={() => setIsDownloadManagerOpen(false)} />
      )}
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
              selectedFilters.includes(id) ? selectedFilters.filter((item) => item !== id) : [...selectedFilters, id],
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
        {isWorklist && <WorklistSearch studies={studies} />}
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


const worklistStateOptions = ['Open', 'All', 'Scheduled', 'In-progress', 'Completed', 'Cancelled'].map(v => {
  return { value: v, label: v };
});


function WorklistSearch({ studies }) {
  // Component used for worklist search

  const {
    assignedUserSearch,
    setAssignedUserSearch,
    groupSearch,
    setGroupSearch,
    worklistStateSearch,
    setWorklistStateSearch,
  } = useWorklistContext();
  const usersOptions = Array.from(
    new Map(studies.map(item => [item.AssignedUser.id, item.AssignedUser])).values(),
  ).map(user => ({
    value: user.id,
    label: user.value,
  }));

  const groupsOptions = Array.from(
    new Map(studies.map(item => [item.GroupName.id, item.GroupName])).values(),
  ).map(group => ({
    value: group.id,
    label: group.value,
  }));


  return (
    <>
      <Autocomplete
        selectedOptions={assignedUserSearch ? [assignedUserSearch] : []}
        title="User"
        options={usersOptions}
        onSelectOption={value => {
          setAssignedUserSearch(value);
        }}
      />
      <Autocomplete
        selectedOptions={groupSearch ? [groupSearch] : []}
        title="Group"
        options={groupsOptions}
        onSelectOption={value => {
          setGroupSearch(value);
        }}
      />
      <Autocomplete
        selectedOptions={worklistStateSearch ? [worklistStateSearch] : []}
        title='State'
        options={worklistStateOptions}
        onSelectOption={value => {
          setWorklistStateSearch(value);
        }}
      />
    </>
  );
}



Filters.propTypes = {
  onChangeDates: PropTypes.func.isRequired,
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  onRefresh: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  onChangeFilterValue: PropTypes.func.isRequired,
  filters: PropTypes.object,
  selectedFilters: PropTypes.arrayOf(PropTypes.string).isRequired,
  setSelectedFilters: PropTypes.func.isRequired,
};
