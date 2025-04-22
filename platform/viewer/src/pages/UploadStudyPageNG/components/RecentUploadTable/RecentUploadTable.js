import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import qs from 'query-string';

import useStudiesTable from '@ohif/sonador-viewer/src/hooks/useStudiesTable';
import { useDebounce } from '@ohif/ui';

import StudyListNG from '../../../../components/studyList/StudyListNG/StudyListNG';
import useStudies from '../../../../hooks/useStudies';
import useTags from '../../../../hooks/useTags';
import { useStudiesTableFiltersAndColumnsStore } from '../../../../store/useStudiesTableFiltersAndColumnsStore';

export default function RecentUploadTable() {
  const location = useLocation();

  const { search } = qs.parse(location.search.replace('?', ''));

  const [studyStartDate, setStartStudyDate] = useState('');
  const [studyEndDate, setStudyEndDate] = useState('');
  const [forceRerender, setForceRerender] = useState(Math.random());

  const debouncedSearch = useDebounce(search, 500);
  const { uploadStudiesSelectedColumns, setUploadStudiesSelectedColumns } = useStudiesTableFiltersAndColumnsStore();

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
    tags,
  });

  const refreshApp = () => {
    setForceRerender(Math.random());
  };

  return (
    <StudyListNG
      title="Recent Upload"
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
      noFilters
      error={error}
      selectedColumns={uploadStudiesSelectedColumns}
      setSelectedColumns={setUploadStudiesSelectedColumns}
    />
  );
}
