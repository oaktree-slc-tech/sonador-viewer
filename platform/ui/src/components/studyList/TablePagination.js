import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import './PaginationArea.styl';

const TablePagination = ({
  pageOptions = [5, 10, 25, 50, 100, 200, 500],
  currentPage = 0,
  nextPageFunc,
  onRowsPerPageChange,
  prevPageFunc,
  recordCount,
  rowsPerPage = 50,
}) => {
  const { t } = useTranslation('Common');

  const nextPage = () => {
    nextPageFunc(currentPage);
  };

  const prevPage = () => {
    prevPageFunc(currentPage);
  };

  const handleRowsPerPageChange = (event) => {
    onRowsPerPageChange(parseInt(event.target.value));
  };

  return (
    <div className="pagination-area">
      <div className="rows-dropdown">
        <div className="form-inline form-group rows-per-page">
          <span>{t('Show')}</span>
          <select onChange={handleRowsPerPageChange} defaultValue={rowsPerPage}>
            {pageOptions.map((pageNumber) => {
              return (
                <option key={pageNumber} value={pageNumber}>
                  {pageNumber}
                </option>
              );
            })}
          </select>
          <span>{t('RowsPerPage')}</span>
        </div>
      </div>
      <div className="pagination-buttons">
        <div className="form-inline form-group page-number pull-right">
          <div className="col-xs-8 col-sm-9 col-md-9">
            <div className="form-inline form-group page-buttons noselect">
              <ul className="pagination-control no-margins">
                <li className="page-item prev">
                  <button onClick={prevPage} disabled={currentPage === 0} className="btn page-link">
                    {t('Previous')}
                  </button>
                </li>
                <li className="page-item next">
                  <button
                    onClick={nextPage}
                    disabled={recordCount === 0 || rowsPerPage > recordCount}
                    className="btn page-link"
                  >
                    {t('Next')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

TablePagination.propTypes = {
  pageOptions: PropTypes.array,
  rowsPerPage: PropTypes.number.isRequired,
  currentPage: PropTypes.number.isRequired,
  nextPageFunc: PropTypes.func,
  prevPageFunc: PropTypes.func,
  onRowsPerPageChange: PropTypes.func,
  recordCount: PropTypes.number.isRequired,
};

export { TablePagination };
