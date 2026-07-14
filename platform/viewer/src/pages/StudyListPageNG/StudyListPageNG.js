import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
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


export default function StudyListPageNG() {
  // Sonador Viewer Studylist

  const location = useLocation();
  const navigate = useNavigate();
  const serverCount = useSelector(redux.selectors.serverCount);

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

  // Study list permissions
  const canQueryStudies = activeServer?.perms?.query;
  const canUpload = activeServer?.perms?.upload;
  const canWorkInWorklist = activeServer?.perms?.worklist;
  const studyListAccess = canQueryStudies || canWorkInWorklist;

  // Determine any redirects which need to be applied
  const shouldRedirectWorklists = activeServer && studyListAccess && !canQueryStudies && canWorkInWorklist;
  const shouldRedirectShared = activeServer && !studyListAccess && canUpload;

  useEffect(() => {

    if (shouldRedirectWorklists) {
      
      // Redirect to worklist if the user does not have access to the `query` permission
      navigate('/worklist');
    } else if (shouldRedirectShared) {
      
      // Redirect to "Shared with me" if the user does not have access to `query` or `worklist`, 
      // but does have access to `upload`
      navigate('/shared');
    }

  }, [shouldRedirectWorklists, shouldRedirectShared]);
  

  return (
    <Layout noHorizontalPadding fixedHeight>

      {(serverCount > 0) && studyListAccess && canQueryStudies && (
        
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
      )}

      {(serverCount == 0) && (
        <EmptyStateIndicator />
      )}
    </Layout>
  );
}
