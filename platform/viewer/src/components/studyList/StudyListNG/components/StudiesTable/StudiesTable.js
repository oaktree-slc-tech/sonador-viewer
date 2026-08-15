import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flexRender } from '@tanstack/react-table';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import useClickOutside from '@ohif/sonador-viewer/src/hooks/useClickOutside';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import { ReactComponent as CaretIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as ChevronDown } from '@ohif/ui/src/elements/Svg/svgs/chevron-down.svg';

import { LocalCacheService } from '@ohif/core';

import { isSortableColumn } from '../../../../../lib/studyListSorting';
import { useDeviceStore } from '../../../../../store/useDeviceStore';
import StudyItemExpandedNG from '../../../StudyItemExpandedNG/StudyItemExpandedNG';
import StudiesTableActions from '../StudiesTableActions/StudiesTableActions';
import { OFFLINE_INDICATOR_COLUMN_ID } from '../OfflineIndicatorCell/OfflineIndicatorCell';
import useLocalCacheVersion from '../../hooks/useLocalCacheVersion';

import styles from './StudiesTable.module.scss';

// Columns that carry row controls/state rather than a DICOM attribute: their headers render as-is,
// without the sort affordance and label treatment the tag columns get.
const RAW_HEADER_COLUMN_IDS = ['selector-settings-expander', OFFLINE_INDICATOR_COLUMN_ID];

const SORT_DIRECTIONS = [
  { direction: 'asc', label: 'ascending' },
  { direction: 'desc', label: 'descending' },
];

function StaticHeader({ children }) {
  // Header for a column the server holds no orderable field for. The room the carets take is
  // reserved regardless, so that every label in the header row starts at the same offset.
  return (
    <div className={classNames(styles.studiesTableHeaderItem, styles.static)}>
      <div className={styles.studiesTableHeaderSpacer} />
      <span>{children}</span>
    </div>
  );
}

StaticHeader.propTypes = {
  children: PropTypes.node,
};

function SortableHeader({ columnId, sorting, onSorting, children }) {
  // Header for a column the imaging server can order by. The label cycles the column's sort
  // (ascending, descending, then back to the list's default order); the carets each name a
  // direction outright, so ordering descending does not mean clicking through ascending first, and
  // each toggles -- clicking the order in force takes the sort off again.
  //
  // The column currently in force keeps its carets visible -- the rest only show on hover -- and is
  // rendered white and heavier than the other headers so the active sort is legible at a glance.
  const isSorted = !!sorting?.fieldName && sorting.fieldName === columnId;
  const activeDirection = isSorted ? sorting.direction : null;

  return (
    <div className={classNames(styles.studiesTableHeaderItem, { [styles.sorted]: isSorted })}>
      <div className={styles.studiesTableHeaderSorting}>
        {SORT_DIRECTIONS.map(({ direction, label }) => (
          <button
            key={direction}
            type="button"
            aria-label={activeDirection === direction ? `Remove ${label} sort` : `Sort ${label}`}
            aria-pressed={activeDirection === direction}
            className={classNames(styles.studiesTableHeaderSortingButton, {
              [styles.active]: activeDirection === direction,
            })}
            onClick={() => onSorting(columnId, direction)}
          >
            <CaretIcon
              className={classNames(styles.studiesTableHeaderSortingIcon, {
                [styles.studiesTableHeaderSortingUpIcon]: direction === 'asc',
              })}
            />
          </button>
        ))}
      </div>
      <button type="button" className={styles.studiesTableHeaderLabel} onClick={() => onSorting(columnId)}>
        {children}
      </button>
    </div>
  );
}

SortableHeader.propTypes = {
  columnId: PropTypes.string.isRequired,
  sorting: PropTypes.object,
  onSorting: PropTypes.func.isRequired,
  children: PropTypes.node,
};

export default function StudiesTable({
  rows,
  sorting,
  studies,
  isLoading,
  headers,
  selectedRows,
  onChangeRowsPerPage,
  onClickNextPage,
  onClickPrevPage,
  pageNumber,
  rowsPerPage,
  onSorting,
  error,
  isFilters,
  isWorkList,
  isFetching,
  setColumnOrder,
  columnOrder
}) {
  const { t } = useTranslation(['StudyList']);

  const { isDesktop } = useDeviceStore();

  // Re-render on local-cache changes so cached rows pick up the heavier font weight (FR-6).
  useLocalCacheVersion();

  const [isOpenedRowsPerPage, setIsOpenedRowsPerPage] = useState(false);
  const [draggingColumnId, setDraggingColumnId] = useState(null);

  const handleDragStart = (e, columnId) => {
    setDraggingColumnId(columnId);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetColumnId) => {
    e.preventDefault();
    if (draggingColumnId === null || draggingColumnId === targetColumnId) return;

    const newOrder = [...columnOrder];
    const fromIndex = newOrder.indexOf(draggingColumnId);
    const toIndex = newOrder.indexOf(targetColumnId);

    newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, draggingColumnId);
    setColumnOrder(newOrder);
    setDraggingColumnId(null);
  };

  const callback = useCallback(() => setIsOpenedRowsPerPage(false), [setIsOpenedRowsPerPage]);

  const tableContainerRef = useRef(null);
  const perPageRef = useRef(null);
  useClickOutside(perPageRef, callback);

  const handleClickRowPerPageOption = (count) => {
    setIsOpenedRowsPerPage(false);
    onChangeRowsPerPage(count);
  };

  useEffect(() => {
    if (isFetching || !studies.length || error) {
      tableContainerRef.current?.scrollTo({ left: 0 });
    }
  }, [isFetching, studies.length, error]);

  return (
    <div className={styles.tableSection}>
      <div
        className={classNames(styles.tableToolbar, styles.horizontalPadding)}
      >
        {isDesktop && <StudiesTableActions  selectedRows={selectedRows} isWorkList={isWorkList} />}
        <div className={styles.tablePagination}>
          <div className={styles.rowsPerPage__wrapper} ref={perPageRef}>
            <div className={styles.rowsPerPage__label}>
              <span>Rows:</span>
              <button className={styles.rowsPerPage} onClick={() => setIsOpenedRowsPerPage((prevState) => !prevState)}>
                {rowsPerPage}
                <ChevronDown
                  fill="#fff"
                  className={classNames({
                    [styles.rowsPerPage__chevroUp]: isOpenedRowsPerPage,
                  })}
                />
              </button>
            </div>
            {isOpenedRowsPerPage && (
              <div className={styles.rowsPerPage__options}>
                {[5, 10, 25, 50, 100, 200, 500].map((value) => (
                  <button
                    key={value}
                    className={styles.rowsPerPage__option}
                    onClick={() => handleClickRowPerPageOption(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <button className={styles.prevWrapper} disabled={pageNumber === 0} onClick={onClickPrevPage}>
              <ChevronDown className={styles.prev} fill="#fff" />
            </button>
            <button
              className={styles.nextWrapper}
              disabled={studies.length === 0 || rowsPerPage > studies.length}
              onClick={onClickNextPage}
            >
              <ChevronDown className={styles.next} fill="#fff" />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={tableContainerRef}
        className={classNames(styles.studiesTableContainer, {
          [styles.disabledScroll]: isFetching || !studies.length || error,
        })}
      >
        <table className={styles.studiesTable}>
          <thead>
          {headers.map((headerGroup) => (
            <tr key={headerGroup.id} className={styles.header}>
              {headerGroup.headers.map((header) => {
                if (header.isPlaceholder) return <th key={header.id} />;

                // The offline indicator stays pinned beside the row controls, so it is neither
                // draggable nor a drop target for the reorderable tag columns.
                const isOfflineIndicator = header.id === OFFLINE_INDICATOR_COLUMN_ID;

                return (
                  <th
                    style={{borderTop: 'none', borderBottom: 'none'}}
                    key={header.id}
                    className={classNames({ [styles.offlineIndicatorCell]: isOfflineIndicator })}
                    draggable={!isOfflineIndicator}
                    onDragStart={(e) => handleDragStart(e, header.id)}
                    onDragOver={isOfflineIndicator ? undefined : handleDragOver}
                    onDrop={isOfflineIndicator ? undefined : (e) => handleDrop(e, header.id)}
                  >
                    {RAW_HEADER_COLUMN_IDS.includes(header.id) ? (
                      flexRender(header.column.columnDef.header, header.getContext())
                    ) : isSortableColumn(header.id) ? (
                      <SortableHeader columnId={header.id} sorting={sorting} onSorting={onSorting}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </SortableHeader>
                    ) : (
                      // Columns the server holds no orderable field for carry no sort control:
                      // offering one would only issue a query the server rejects.
                      <StaticHeader>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </StaticHeader>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
          </thead>

          <tbody>
            {!isFetching &&
              !!studies.length &&
              rows.map((row, index) => {
                const isExpanded = row.getIsExpanded();

                const studyId = isWorkList? row.original.StudyInstanceUID.value: row.id

                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => {
                        tableContainerRef.current?.scrollTo({ left: 0 });
                        row.getToggleExpandedHandler()();
                      }}
                      className={classNames(styles.row, {
                        [styles.expanded]: isExpanded,
                        [styles.odd]: index % 2 === 0,
                        [styles.withRightBorder]: !isExpanded,
                        // Heavier font weight for locally-cached studies (FR-6).
                        [styles.cached]: LocalCacheService?.isStudyCachedSync(studyId),
                      })}
                    >
                      {row.getVisibleCells().map((cell) => {
                        return (
                          <td
                            key={cell.id}
                            style={{borderTop: 'none', borderBottom:'none'}}
                            className={classNames({
                              [styles.offlineIndicatorCell]: cell.column.id === OFFLINE_INDICATOR_COLUMN_ID,
                            })}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={row.getVisibleCells().length} style={{borderTop:'none', borderBottom:'none'}} className={styles.expandedContainer}>
                          <StudyItemExpandedNG studyId={studyId}  study={row.original} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
        {isFetching && (
          <div className={styles.loaderContainer}>
            <Loader />
          </div>
        )}
        {!isFetching && (!studies.length || error) && (
          <p className={styles.noMatchingResults}>
            {error ? `Error: ${JSON.stringify(error)}` : t('No matching results')}
          </p>
        )}
      </div>
    </div>
  );
}


StudiesTable.propTypes = {
  isLoading: PropTypes.bool.isRequired,
  isFetching: PropTypes.bool.isRequired,
  studies: PropTypes.array.isRequired,
  sorting: PropTypes.shape({
    fieldName: PropTypes.oneOfType([PropTypes.string]),
    direction: PropTypes.oneOfType([PropTypes.string]),
  }).isRequired,
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  headers: PropTypes.array.isRequired,
  selectedRows: PropTypes.arrayOf(PropTypes.object),
  onClickNextPage: PropTypes.func.isRequired,
  onClickPrevPage: PropTypes.func.isRequired,
  rowsPerPage: PropTypes.number.isRequired,
  pageNumber: PropTypes.number.isRequired,
  onChangeRowsPerPage: PropTypes.func.isRequired,
  onSorting: PropTypes.func.isRequired,
  error: PropTypes.object,
  isFilters: PropTypes.bool.isRequired,
  isWorkList: PropTypes.bool,
};
