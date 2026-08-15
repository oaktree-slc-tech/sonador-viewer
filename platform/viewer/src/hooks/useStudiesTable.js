import { useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';

import { useDebounce } from '@ohif/ui';

// Order the list arrives in, and the order it returns to when a column sort is taken off. Most
// recently updated first: `Modified` is the resource's mtime rather than a DICOM tag, so no column
// header is marked as sorted while it is in force. Removing a sort restores this rather than
// leaving the query with no ordering at all, which would let rows move between pages as they are
// paged through.
const DEFAULT_SORTING = { fieldName: 'Modified', direction: 'desc' };

export default function useStudiesTable() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [sorting, setSorting] = useState(DEFAULT_SORTING);

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

  const handleSorting = (fieldName, direction) => {
    // A direction is passed when the user clicks one of the header's caret buttons, which name the
    // order they want rather than advancing through one. Each caret toggles: clicking the order
    // already in force removes it and returns the list to its default order, so a sort can be
    // taken off without cycling through the opposite direction first.
    if (direction) {
      const isActive = fieldName === sorting.fieldName && direction === sorting.direction;

      setSorting(isActive ? DEFAULT_SORTING : { fieldName, direction });
      return;
    }

    // Clicking the header label instead cycles the column: ascending, descending, then off again.
    if (fieldName === sorting.fieldName) {
      setSorting(sorting.direction === 'asc' ? { fieldName, direction: 'desc' } : DEFAULT_SORTING);
      return;
    }

    setSorting({ fieldName, direction: 'asc' });
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
