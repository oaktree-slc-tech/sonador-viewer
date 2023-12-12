import { useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';

import { useDebounce } from '@ohif/ui';

export default function useStudiesTable() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [sorting, setSorting] = useState({ fieldName: 'PatientName', direction: 'asc' });

  const debouncedSort = useDebounce(sorting, 200);

  const filters = new URLSearchParams(location.search);
  const rowsCount = filters.get('items');
  const page = filters.get('page');
  const pageNumber = page ? parseInt(page) - 1 : 0;
  const rowsPerPage = rowsCount ? parseInt(rowsCount) : 100;

  const updateRowsPerPage = (rowsCount) => {
    filters.set('items', rowsCount);
    navigate({ search: filters.toString() });
  };

  const updatePageNumber = (page) => {
    filters.set('page', page + 1);
    navigate({ search: filters.toString() });
  };

  const handleSorting = (fieldName) => {
    let sortFieldName = fieldName;
    let sortDirection = 'asc';

    if (fieldName === sorting.fieldName) {
      if (sorting.direction === 'asc') {
        sortDirection = 'desc';
      } else {
        sortFieldName = null;
        sortDirection = null;
      }
    }

    setSorting({
      fieldName: sortFieldName,
      direction: sortDirection,
    });
  };

  return {
    debouncedSort,
    rowsPerPage,
    pageNumber,
    sorting,
    activeServer,
    handleSorting,
    updatePageNumber,
    updateRowsPerPage,
  };
}
