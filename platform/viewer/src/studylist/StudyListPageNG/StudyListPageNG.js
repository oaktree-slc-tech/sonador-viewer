import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import qs from 'querystring';

import { useDebounce } from '@ohif/ui';

import useStudiesTable from '../../hooks/useStudiesTable';
import Layout from '../../layouts/Layout/Layout';
import StudyListNG from '../StudyListNG/StudyListNG';

import { useStudies, useTags } from './logic';

export default function StudyListPageNG() {
  const location = useLocation();

  const { search } = qs.parse(location.search.replace('?', ''));

  const [studyStartDate, setStartStudyDate] = useState('');
  const [studyEndDate, setStudyEndDate] = useState('');
  const [forceRerender, setForceRerender] = useState(Math.random());
  const [filters, setFilters] = useState({});

  const debouncedSearch = useDebounce(search, 500);
  const debouncedFilters = useDebounce(filters, 500);

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
        filters={filters}
        onChangeFilterValue={setFilters}
        error={error}
      />
    </Layout>
  );
}
