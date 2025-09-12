import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import qs from 'query-string';

import OHIF from '@ohif/core';
import { useDebounce } from '@ohif/ui';

import { useStudiesTableFilters } from '../../store/useStudiesTableFilters';
import { useStudiesTableFiltersAndColumnsStore } from '../../store/useStudiesTableFiltersAndColumnsStore';

import useStudies from '../../hooks/useStudies';
import useStudiesTable from '../../hooks/useStudiesTable';
import useTags from '../../hooks/useTags';

import Layout from '../../layouts/Layout/Layout';

import StudyListNG from '../../components/studyList/StudyListNG/StudyListNG';
import EmptyStateIndicator from '../../components/emptyState/EmptyStateIndicator';

const { redux } = OHIF;


export default function SharedWithMePageNG() {
  // Studies shared with the active user

  const location = useLocation();
  const serverCount = useSelector(redux.selectors.serverCount);

  const { search } = qs.parse(location.search.replace('?', ''));

  const [studyStartDate, setStartStudyDate] = useState('');
  const [studyEndDate, setStudyEndDate] = useState('');
  const [forceRerender, setForceRerender] = useState(Math.random());

  const { sharedWithMePageFilters, setSharedWithMePageFilters } = useStudiesTableFilters();
  const {
    sharedStudiesSelectedColumns,
    sharedStudiesSelectedFilters,
    setSharedStudiesSelectedColumns,
    setSharedStudiesSelectedFilters,
  } = useStudiesTableFiltersAndColumnsStore();

  const debouncedSearch = useDebounce(search, 500);
  const debouncedFilters = useDebounce(sharedWithMePageFilters, 500);

  const {
    debouncedSort,
    updateRowsPerPage,
    updatePageNumber,
    handleSorting,
    pageNumber,
    rowsPerPage,
    sorting,
    activeServer,
  } = useStudiesTable();

  const { data: tags } = useTags({ server: activeServer });

  const {
    data: studies,
    isLoading,
    isFetching,
    error,
  } = useStudies({
    server: activeServer,
    allFields: debouncedSearch,
    studyDateFrom: studyStartDate,
    studyDateTo: studyEndDate,
    sort: debouncedSort,
    rowsPerPage,
    pageNumber,
    isForce: forceRerender,
    filters: debouncedFilters,
    tags,
    requireExplicitAccess: true,
  });

  const refreshApp = () => {
    setForceRerender(Math.random());
  };

  return (
    <Layout noHorizontalPadding>
      {(serverCount > 0) && (
        <StudyListNG
          title="Shared"
          isLoading={isLoading}
          isFetching={isFetching}
          studies={studies || []}
          onClickNextPage={() => updatePageNumber(pageNumber + 1)}
          onClickPrevPage={() => updatePageNumber(pageNumber - 1)}
          rowsPerPage={rowsPerPage}
          pageNumber={pageNumber}
          onRefresh={refreshApp}
          onChangeRowsPerPage={updateRowsPerPage}
          server={activeServer}
          startDate={studyStartDate}
          endDate={studyEndDate}
          onChangeDates={(startDate, endDate) => {
            setStartStudyDate(startDate);
            setStudyEndDate(endDate);
          }}
          sorting={sorting}
          onSorting={handleSorting}
          filters={sharedWithMePageFilters}
          onChangeFilterValue={setSharedWithMePageFilters}
          error={error}
          selectedFilters={sharedStudiesSelectedFilters}
          selectedColumns={sharedStudiesSelectedColumns}
          setSelectedColumns={setSharedStudiesSelectedColumns}
          setSelectedFilters={setSharedStudiesSelectedFilters}
        />
      )}

      {(serverCount == 0) && (
        <EmptyStateIndicator />
      )}
    </Layout>
  );
}
