import React, { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import qs from 'query-string';

import { useDebounce } from '@ohif/ui';

import StudyListNG from '../../components/studyList/StudyListNG/StudyListNG';
import useStudiesTable from '../../hooks/useStudiesTable';

import Layout from '../../layouts/Layout/Layout';
import { useWorklistItems } from '../../queries/worklist';
import { useStudiesTableFilters } from '../../store/useStudiesTableFilters';
import { useStudiesTableFiltersAndColumnsStore } from '../../store/useStudiesTableFiltersAndColumnsStore';

import { WorklistContextProvider } from './worklist.context';


export default function WorkListPageNG() {
  // Sonador Viewer: Reviewer Worklist

  const location = useLocation();

  const { search } = qs.parse(location.search.replace('?', ''));

  const [studyStartDate, setStartStudyDate] = useState('');
  const [studyEndDate, setStudyEndDate] = useState('');
  const [forceRerender, setForceRerender] = useState(Math.random());

  const { workListPageFilters, setWorkListPageFilters } = useStudiesTableFilters();
  const {
    workListStudiesSelectedColumns,
    workListStudiesSelectedFilters,
    setWorkListStudiesSelectedColumns,
    setWorkListStudiesSelectedFilters,
  } = useStudiesTableFiltersAndColumnsStore();

  const debouncedSearch = useDebounce(search, 500);

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

  // const { data: tags } = useTags({ server: activeServer });

  // const { data, error: worklistError, isLoading: isLoadingWorklist } = useWorklist(activeServer);
  // const {
  //   data: studies,
  //   isLoading,
  //   error,
  // } = useStudies({
  //   server: activeServer,
  //   allFields: debouncedSearch,
  //   studyDateFrom: studyStartDate,
  //   studyDateTo: studyEndDate,
  //   sort: debouncedSort,
  //   rowsPerPage,
  //   pageNumber,
  //   isForce: forceRerender,
  //   filters: debouncedFilters,
  //   tags,
  // });

  // Filter by user, group, and worklist state
  const [assignedUserSearch, setAssignedUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [worklistStateSearch, setWorklistStateSearch] = useState('');
  
  const filters = useMemo(() => {
    // Worklist search filters

    const offset = pageNumber >1?(pageNumber - 1) * rowsPerPage:0;
    return {
      allFields: debouncedSearch,
      limit: rowsPerPage,
      offset,
      ...workListPageFilters,
      ...(assignedUserSearch && { User: assignedUserSearch }),
      ...(groupSearch && { Group: groupSearch }),
      ...(worklistStateSearch && { State: worklistStateSearch }),
    };
  }, [workListPageFilters, assignedUserSearch, groupSearch, worklistStateSearch, debouncedSearch, rowsPerPage, pageNumber]);

  const debouncedFilters = useDebounce(filters, 500);

  const { data: worklist, isLoading,isFetching, error } = useWorklistItems({
    server: activeServer,
    filters: debouncedFilters ,
    studyStartDate,
    studyEndDate,
    pageNumber,
    isForce: forceRerender,
  });

  const refreshApp = () => {
    setForceRerender(Math.random());
  };

  return (
    <Layout noHorizontalPadding>
      <WorklistContextProvider value={{
        assignedUserSearch,
        setAssignedUserSearch,
        groupSearch,
        setGroupSearch,
        worklistStateSearch,
        setWorklistStateSearch,
      }}>
        <StudyListNG
          title="Worklist"
          isLoading={isLoading}
          isFetching={isFetching}
          studies={worklist || []}
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
          filters={workListPageFilters}
          onChangeFilterValue={setWorkListPageFilters}
          error={error}
          isWorkList
          selectedFilters={workListStudiesSelectedFilters}
          selectedColumns={workListStudiesSelectedColumns}
          setSelectedColumns={setWorkListStudiesSelectedColumns}
          setSelectedFilters={setWorkListStudiesSelectedFilters}
        />
      </WorklistContextProvider>
    </Layout>
  );
}
