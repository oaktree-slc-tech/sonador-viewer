import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import qs from 'query-string';

import { useDebounce } from '@ohif/ui';

import StudyListNG from '../../components/studyList/StudyListNG/StudyListNG';
import useStudies from '../../hooks/useStudies';
import useStudiesTable from '../../hooks/useStudiesTable';
import useTags from '../../hooks/useTags';
import Layout from '../../layouts/Layout/Layout';
import { useStudiesTableFilters } from '../../store/useStudiesTableFilters';
import { useStudiesTableFiltersAndColumnsStore } from '../../store/useStudiesTableFiltersAndColumnsStore';

export default function StudyListPageNG() {
  const location = useLocation();

  const { search } = qs.parse(location.search.replace('?', ''));

  const [studyStartDate, setStartStudyDate] = useState('');
  const [studyEndDate, setStudyEndDate] = useState('');
  const [forceRerender, setForceRerender] = useState(Math.random());

  const { studyListPageFilters, setStudyListPageFilters } = useStudiesTableFilters();
  const {
    allStudiesSelectedColumns,
    allStudiesSelectedFilters,
    setAllStudiesSelectedColumns,
    setAllStudiesSelectedFilters,
  } = useStudiesTableFiltersAndColumnsStore();

  const debouncedSearch = useDebounce(search, 500);
  const debouncedFilters = useDebounce(studyListPageFilters, 500);

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
  });

  const refreshApp = () => {
    setForceRerender(Math.random());
  };

  return (
    <Layout noHorizontalPadding>
      <StudyListNG
        title="All studies"
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
        filters={studyListPageFilters}
        onChangeFilterValue={setStudyListPageFilters}
        error={error}
        selectedColumns={allStudiesSelectedColumns}
        selectedFilters={allStudiesSelectedFilters}
        setSelectedFilters={setAllStudiesSelectedFilters}
        setSelectedColumns={setAllStudiesSelectedColumns}
      />
    </Layout>
  );
}
