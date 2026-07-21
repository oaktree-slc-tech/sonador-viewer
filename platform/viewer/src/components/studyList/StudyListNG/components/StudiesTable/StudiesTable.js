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

import { useDeviceStore } from '../../../../../store/useDeviceStore';
import StudyItemExpandedNG from '../../../StudyItemExpandedNG/StudyItemExpandedNG';
import StudiesTableActions from '../StudiesTableActions/StudiesTableActions';
import useLocalCacheVersion from '../../hooks/useLocalCacheVersion';

import styles from './StudiesTable.module.scss';

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

                return (
                  <th
                    style={{borderTop: 'none', borderBottom: 'none'}}
                    key={header.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, header.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, header.id)}
                  >
                    {header.id !== 'selector-settings-expander' ? (
                      <div
                        tabIndex={0}
                        role='button'
                        className={styles.studiesTableHeaderItem}
                        onClick={() => onSorting(header.id)}
                      >
                        <div className={styles.studiesTableHeaderSorting}>
                          <CaretIcon
                            fill={
                              sorting.fieldName === header.id && sorting.direction === 'asc'
                                ? 'rgb(169, 169, 169)'
                                : 'rgb(122, 124, 132)'
                            }
                            className={styles.studiesTableHeaderSortingUpIcon}
                          />
                          <CaretIcon
                            fill={
                              sorting.fieldName === header.id && sorting.direction === 'desc'
                                ? 'rgb(169, 169, 169)'
                                : 'rgb(122, 124, 132)'
                            }
                          />
                        </div>
                        <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      </div>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
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
                        return <td key={cell.id} style={{borderTop: 'none', borderBottom:'none'}}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
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
