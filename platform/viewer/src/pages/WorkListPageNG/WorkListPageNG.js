import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import qs from 'query-string';

import DICOMWeb from '@ohif/core/src/DICOMWeb';
import { useDebounce } from '@ohif/ui';

import StudyListNG from '../../components/studyList/StudyListNG/StudyListNG';
import useStudiesTable from '../../hooks/useStudiesTable';
import useTags from '../../hooks/useTags';
import Layout from '../../layouts/Layout/Layout';
import { useWorklistItems } from '../../queries/worklist';
import { useStudiesTableFilters } from '../../store/useStudiesTableFilters';
import { useStudiesTableFiltersAndColumnsStore } from '../../store/useStudiesTableFiltersAndColumnsStore';

function useWorklist(server) {
  const [domain] = server?.qidoRoot
    ? server?.qidoRoot?.match(/^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)/gim) || ['']
    : [''];
  const [port] = server?.qidoRoot ? server?.qidoRoot?.match(/:\d+/) || [''] : [''];
  const url = `${domain}${port}`;

  return useQuery({
    queryKey: ['worklist', server?.token],
    queryFn: () =>
      fetch(`${url}/dicom-web/worklist/studies?User=1`, {
        headers: DICOMWeb.getAuthorizationHeader(server),
      }).then((res) => res.json()),
  });
}
export default function WorkListPageNG() {
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
  const debouncedFilters = useDebounce(workListPageFilters, 500);

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

  const { data, error: worklistError, isLoading: isLoadingWorklist } = useWorklist(activeServer);

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

  const {data: worklist, isLoading, error} = useWorklistItems({
    server: activeServer,
    filters: debouncedFilters,
    isForce: forceRerender,
  })

  const refreshApp = () => {
    setForceRerender(Math.random());
  };

  return (
    <Layout noHorizontalPadding>
      <StudyListNG
        title="Worklist"
        isLoading={isLoading}
        studies={worklist||[]}
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
    </Layout>
  );
}
