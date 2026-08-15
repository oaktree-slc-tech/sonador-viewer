import _ from 'lodash';

import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import qs from 'query-string';

import OHIF, { redux, DicomMetadataStore } from '@ohif/core';
import { useDebounce } from '@ohif/ui';

import { useStudiesTableFilters } from '../../store/useStudiesTableFilters';
import { useStudiesTableFiltersAndColumnsStore } from '../../store/useStudiesTableFiltersAndColumnsStore';

import useStudiesTable from '../../hooks/useStudiesTable';
import useStudyListRefresh from '../../hooks/useStudyListRefresh';
import { getOrderByParam } from '../../lib/studyListSorting';
import { useWorklistItems } from '../../queries/worklist';

import Layout from '../../layouts/Layout/Layout';
import StudyListNG from '../../components/studyList/StudyListNG/StudyListNG';
import EmptyStateIndicator from '../../components/emptyState/EmptyStateIndicator';

import { WorklistContextProvider } from './worklist.context';


export default function WorkListPageNG() {
  // Sonador Viewer: Reviewer Worklist

  const location = useLocation();
  const serverCount = useSelector(redux.selectors.serverCount);

  const { search } = qs.parse(location.search.replace('?', ''));

  const [studyStartDate, setStartStudyDate] = useState('');
  const [studyEndDate, setStudyEndDate] = useState('');
  // Refresh: re-seeds the row query AND drops the memoised series metadata the drawer reads.
  const { forceRerender, refreshApp } = useStudyListRefresh();

  const { workListPageFilters, setWorkListPageFilters } = useStudiesTableFilters();
  const {
    workListStudiesSelectedColumns,
    workListStudiesSelectedFilters,
    workListColumnOrder,
    setWorkListStudiesSelectedColumns,
    setWorkListStudiesSelectedFilters,
    setWorkListColumnOrder,
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

  // Filter by user, group, and worklist state
  const [assignedUserSearch, setAssignedUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [worklistStateSearch, setWorklistStateSearch] = useState('');
  
  const filters = useMemo(() => {
    // Worklist search filters

    const offset = pageNumber >1?(pageNumber - 1) * rowsPerPage:0;

    // Sorting is applied by the imaging server. The worklist rows the table holds are one page of
    // a larger result set, so the sort has to travel with the query -- it is part of `filters`
    // precisely so that changing it re-keys the query and refetches, the same as any other filter.
    const orderBy = getOrderByParam(debouncedSort);

    return {
      allFields: debouncedSearch,
      limit: rowsPerPage,
      offset,
      ...workListPageFilters,
      ...(assignedUserSearch && { User: assignedUserSearch }),
      ...(groupSearch && { Group: groupSearch }),
      ...(worklistStateSearch && { State: worklistStateSearch }),
      ...(orderBy && { OrderBy: orderBy }),
    };
  }, [workListPageFilters, assignedUserSearch, groupSearch, worklistStateSearch, debouncedSearch, rowsPerPage, pageNumber, debouncedSort]);

  const debouncedFilters = useDebounce(filters, 500);

  const { data: worklist, isLoading,isFetching, error } = useWorklistItems({
    server: activeServer,
    filters: debouncedFilters ,
    studyStartDate,
    studyEndDate,
    pageNumber,
    isForce: forceRerender,
  });

  // Add worklist studies to DicomMetadataStore to facilitate state lookup for other components.
  _.each(worklist, (w) => {

    // Retrieve study from DicomMetadataStore, create the study if it does not already exist
    const StudyInstanceUID = _.isObject(w.StudyInstanceUID) ? w.StudyInstanceUID.value : w.StudyInstanceUID;
    const _study = DicomMetadataStore.getStudy(StudyInstanceUID);
    if (!_study) {
      DicomMetadataStore.addStudy({ StudyInstanceUID });
    }
    
    // Add reference to the worklistId in the studyMetadata
    const studyMeta = _.defaults(DicomMetadataStore.getStudyMetadata(StudyInstanceUID) || {}, {
      StudyInstanceUID,
      worklistItems: [],
    });
    if (w.id && !_.includes(studyMeta.worklistItems, w.id)) {
      studyMeta.worklistItems.push(w.id);
    }

    // Update metadata store
    DicomMetadataStore.updateStudyMetadata(studyMeta);
  });

  // Study list permissions
  const canWorkInWorklist = activeServer?.perms?.worklist;

  return (
    <Layout noHorizontalPadding fixedHeight>

      {(serverCount > 0) && canWorkInWorklist && (

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
            columnOrder={workListColumnOrder}
            setColumnOrder={setWorkListColumnOrder}
          />
        </WorklistContextProvider>
      )}

      {(serverCount == 0) && (
        <EmptyStateIndicator />
      )}
    </Layout>
  );
}
