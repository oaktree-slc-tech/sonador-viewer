import _ from 'lodash';

import React, { useEffect, useMemo, useState } from 'react';
import { getCoreRowModel, getExpandedRowModel, useReactTable } from '@tanstack/react-table';
import moment from 'moment';
import PropTypes from 'prop-types';
import { useLocalStorage } from 'usehooks-ts'

import { redux, sonador } from '@ohif/core';
import { updateServer } from '../../../hooks/useServer';
import { useMetadataSettingsStore } from '../../../store/useMetadataSettingsStore';

import Filters from './components/Filters/Filters';
import SelectAndSettingsAndExpandCell from './components/SelectAndSettingsAndExpandCell/SelectAndSettingsAndExpandCell';
import SelectSettingsHeader from './components/SelectSettingsHeader/SelectSettingsHeader';
import StudiesTable from './components/StudiesTable/StudiesTable';
import { metadataArr } from './logic';

import styles from './StudyListNG.module.scss';


function StudyListNG({ studies = [], 
  server, 
  sorting, 
  onClickNextPage, 
  onClickPrevPage,
  pageNumber, 
  rowsPerPage, 
  onChangeRowsPerPage, 
  onSorting,
  isLoading,
  isFetching,
  onRefresh,
  startDate,
  endDate,
  onChangeDates,
  title,
  onChangeFilterValue,
  filters,
  noFilters = false,
  error,
  isWorkList = false,
  selectedColumns,
  selectedFilters,
  setSelectedColumns,
  setSelectedFilters,
}) {

  useEffect(() => {
    
    // Retrieve imaging system config (if not already specified on the server model)
    // and configure feature/attribute flags.    

    // Retrieve sysInfo from imaging server to determine which system config options
    // should be enabled for the study list.
    if (!server.sysInfo) {

      sonador.fetchServerSystemInfo(server)
        .then((res) => {
          // Parse sysInfo response to JSON
          
          if (!res.ok) {
            return res.text().then(msg => {
              throw new Error(`HTTP ${res.status}: ${msg}`);
            });
          }
          
          return res.json();
        })
        .then((sysInfo) => {
          // Update server config/state. Enable server configuration options
          // based on which plugins and attributes are available.

          // Parse server configuration and update server properties
          server.sysInfo = sysInfo;
          if (_.includes(sysInfo.ActivePlugins || [], 'ohif')) {
            server.ohifEnabled = true;
          }

          // Update server instance asynchronously to prevent issues with updates
          // being posted to Redux store during render loop.
          setTimeout(50, () => updateServer(server));
        });
    }
  }, []);
  
  const [expanded, setExpanded] = useState({});

  const columns = useMemo(() => {
    return [
      {
        id: 'selector-settings-expander',
        header: ({ table }) => (
          <SelectSettingsHeader
            table={table}
            selectedColumns={selectedColumns}
            setSelectedColumns={setSelectedColumns}
          />
        ),
        cell: ({ row }) => <SelectAndSettingsAndExpandCell row={row}  />,
      },
      ...selectedColumns.map((id) => {
        return {
          header: ({ header }) => {
            const currentIndex = header.index - 1;

            return studies[currentIndex]?.[id]?.label ?? id;
          },
          id,
          accessorKey: id,
          cell: ({ getValue }) => {
            const { value, type } = getValue() || {};

            if (value === undefined) {
              return '';
            }

            return type === 'date' ? moment(value, 'YYYYMMDD').format('MMM DD, YYYY') : value;
          },
        };
      }),
    ];
  }, [selectedColumns, server, studies]);

  const { setMetadataSettings } = useMetadataSettingsStore();

  const [columnOrder, setColumnOrder] = useLocalStorage('columnOrder', columns.map(col => col.id));

  const { getHeaderGroups, getRowModel, getSelectedRowModel } = useReactTable({
    data: studies,
    columns,
    state: { expanded, columnOrder,},
    onExpandedChange: setExpanded,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getRowId: (row) => isWorkList ? row.id : row.StudyInstanceUID?.value,
  });

  const { rows: selectedRows } = getSelectedRowModel();
  const headers = getHeaderGroups();

  useEffect(() => {
    setMetadataSettings(metadataArr);
  }, [setMetadataSettings]);

  return (
    <>
      {!noFilters && (
        <Filters
          isWorklist={isWorkList}
          studies={studies}
          onRefresh={onRefresh}
          endDate={endDate}
          onChangeDates={onChangeDates}
          startDate={startDate}
          title={title}
          onChangeFilterValue={onChangeFilterValue}
          filters={filters}
          selectedFilters={selectedFilters}
          setSelectedFilters={setSelectedFilters}
        />
      )}
      <hr className={styles.filtersActionsDivider} />
      <StudiesTable
        isLoading={isLoading}
        isFetching={isFetching}
        headers={headers}
        sorting={sorting}
        studies={studies}
        rows={getRowModel().rows}
        selectedRows={selectedRows}
        onClickNextPage={onClickNextPage}
        onClickPrevPage={onClickPrevPage}
        pageNumber={pageNumber}
        rowsPerPage={rowsPerPage}
        onChangeRowsPerPage={onChangeRowsPerPage}
        onSorting={onSorting}
        error={error}
        isFilters={!noFilters}
        isWorkList={isWorkList}
        columnOrder={columnOrder}
        setColumnOrder={setColumnOrder}
        filters={filters}
      />
    </>
  );
}

StudyListNG.propTypes = {
  studies: PropTypes.array.isRequired,
  onClickNextPage: PropTypes.func.isRequired,
  onClickPrevPage: PropTypes.func.isRequired,
  rowsPerPage: PropTypes.number.isRequired,
  pageNumber: PropTypes.number.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onChangeRowsPerPage: PropTypes.func.isRequired,
  server: PropTypes.object,
  onChangeDates: PropTypes.func.isRequired,
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  sorting: PropTypes.shape({
    fieldName: PropTypes.oneOfType([PropTypes.string]),
    direction: PropTypes.oneOfType([PropTypes.string]),
  }).isRequired,
  onSorting: PropTypes.func.isRequired,
  isLoading: PropTypes.bool.isRequired,
  isFetching: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  filters: PropTypes.object,
  onChangeFilterValue: PropTypes.func,
  noFilters: PropTypes.bool,
  error: PropTypes.object,
  isWorkList: PropTypes.bool,
  selectedColumns: PropTypes.arrayOf(PropTypes.string),
  setSelectedColumns: PropTypes.func,
  selectedFilters: PropTypes.arrayOf(PropTypes.string),
  setSelectedFilters: PropTypes.func,
};

StudyListNG.displayName = 'StudyListNG';

export default StudyListNG;
