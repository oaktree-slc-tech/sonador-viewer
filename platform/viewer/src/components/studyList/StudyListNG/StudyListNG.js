import React, { useEffect, useMemo, useState } from 'react';
import { getCoreRowModel, getExpandedRowModel, useReactTable } from '@tanstack/react-table';
import moment from 'moment';
import PropTypes from 'prop-types';

import { useMetadataSettingsStore } from '../../../store/useMetadataSettingsStore';
import { useStudiesTableFiltersAndColumnsStore } from '../../../store/useStudiesTableFiltersAndColumnsStore';

import Filters from './components/Filters/Filters';
import SelectAndSettingsAndExpandCell from './components/SelectAndSettingsAndExpandCell/SelectAndSettingsAndExpandCell';
import SelectSettingsHeader from './components/SelectSettingsHeader/SelectSettingsHeader';
import StudiesTable from './components/StudiesTable/StudiesTable';
import { metadataArr } from './logic';

import styles from './StudyListNG.module.scss';

export default function StudyListNG({
  studies = [],
  server,
  sorting,
  onClickNextPage,
  onClickPrevPage,
  pageNumber,
  rowsPerPage,
  onChangeRowsPerPage,
  onSorting,
  isLoading,
  onRefresh,
  startDate,
  endDate,
  onChangeDates,
  title,
  onChangeFilterValue,
  filters,
  noFilters = false,
  error,
}) {
  const [expanded, setExpanded] = useState({});

  const { selectedColumns } = useStudiesTableFiltersAndColumnsStore();

  const columns = useMemo(() => {
    return [
      {
        id: 'selector-settings-expander',
        header: ({ table }) => <SelectSettingsHeader table={table} server={server} />,
        cell: ({ row }) => <SelectAndSettingsAndExpandCell row={row} server={server} />,
      },
      ...selectedColumns.map((id) => {
        return {
          // TODO replace with label when ROb will add
          header: id,
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

  const { getHeaderGroups, getRowModel, getSelectedRowModel } = useReactTable({
    data: studies,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    getRowId: (row) => row.StudyInstanceUID?.value,
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
          onRefresh={onRefresh}
          endDate={endDate}
          onChangeDates={onChangeDates}
          startDate={startDate}
          server={server}
          title={title}
          onChangeFilterValue={onChangeFilterValue}
          filters={filters}
        />
      )}
      <hr className={styles.filtersActionsDivider} />
      <StudiesTable
        isLoading={isLoading}
        headers={headers}
        sorting={sorting}
        studies={studies}
        rows={getRowModel().rows}
        server={server}
        selectedRows={selectedRows}
        onClickNextPage={onClickNextPage}
        onClickPrevPage={onClickPrevPage}
        pageNumber={pageNumber}
        rowsPerPage={rowsPerPage}
        onChangeRowsPerPage={onChangeRowsPerPage}
        onSorting={onSorting}
        error={error}
        isFilters={!noFilters}
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
  title: PropTypes.string.isRequired,
  filters: PropTypes.object,
  onChangeFilterValue: PropTypes.func,
  noFilters: PropTypes.bool,
  error: PropTypes.object,
};
