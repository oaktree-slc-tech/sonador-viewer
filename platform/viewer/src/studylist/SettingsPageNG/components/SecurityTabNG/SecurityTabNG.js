import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import classNames from 'classnames';
import moment from 'moment';
import PropTypes from 'prop-types';

import { useSnackbarContext } from '@ohif/ui';
import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as CopyIcon } from '@ohif/ui/src/elements/Svg/svgs/copy.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { useDeviceStore } from '../../../../store/useDeviceStore';

import { useAccesses, useCreateAccess, useCreateToken, useTokens } from './logic';

import styles from './SecurityTabNG.module.scss';

/**
 *
 * @param {'tokens' | 'ids'} type
 * @param {boolean} isMobile
 * @returns {[{header: (function({table: *}): *), id: string, cell: (function({row: *}): *)},{header: string, id: string, cell: (function({getValue: *}): string), accessorKey: string},{header: string, id: string, accessorKey: string},{header: string, id: string, cell: (function({getValue: *}): string), accessorKey: string}]}
 */
const getColumns = (type, isMobile) => {
  const columns = [
    {
      id: 'selector',
      header: ({ table }) => (
        <CheckboxNG
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          indeterminate={table.getIsSomeRowsSelected()}
        />
      ),
      cell: ({ row }) => <CheckboxNG checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />,
    },
    {
      header: type === 'tokens' ? 'Access Token' : 'Access ID',
      id: type === 'tokens' ? 'token' : 'access_id',
      accessorKey: type === 'tokens' ? 'token' : 'access_id',
      cell: ({ getValue }) => {
        const value = getValue();
        return value ? `${value.slice(0, 4)}... ...${value.slice(-4)}` : 'N/A';
      },
    },
    { header: 'Description', id: 'description', accessorKey: 'description' },
    {
      header: 'Created',
      id: 'ctime',
      accessorKey: 'ctime',
      cell: ({ getValue }) => moment(getValue()).format('MMM DD, YYYY, hh:mm a'),
    },
  ];

  if (isMobile) {
    return columns.filter(({ id }) => id !== 'description');
  }

  return columns;
};

export default function SecurityTabNG({ title, description, type }) {
  const { t } = useTranslation();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [searchValue, setSearchValue] = useState('');
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');

  const { isDesktop, isMobile } = useDeviceStore();

  const {
    data: tokens = [],
    isLoading: isLoadingTokens,
    error: tokensError,
  } = useTokens({
    server: activeServer,
    isEnabled: type === 'tokens',
  });
  const {
    data: accesses = [],
    isLoading: isLoadingAccesses,
    error: idsError,
  } = useAccesses({
    server: activeServer,
    isEnabled: type === 'ids',
  });
  const { mutate: createToken, data: createdTokenData = {} } = useCreateToken();
  const { mutate: createAccess, data: createdAccessData = {} } = useCreateAccess();

  const isDataLoading = type === 'tokens' ? isLoadingTokens : isLoadingAccesses;
  const fetchingError = type === 'tokens' ? tokensError : idsError;

  const snackbar = useSnackbarContext();

  const tableData = (type === 'tokens' ? tokens : accesses).filter((item) => {
    const lowerCasedSearch = searchValue.toLowerCase();

    if (type === 'tokens') {
      return (
        item.description?.toLowerCase().includes(lowerCasedSearch) ||
        item.token.toLowerCase().includes(lowerCasedSearch)
      );
    }

    return (
      item.description?.toLowerCase().includes(lowerCasedSearch) ||
      item.access_id.toLowerCase().includes(lowerCasedSearch)
    );
  });

  const { getHeaderGroups, getRowModel, getSelectedRowModel } = useReactTable({
    data: tableData,
    columns: getColumns(type, isMobile),
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows: selectedRows } = getSelectedRowModel();
  const headers = getHeaderGroups();

  const handleGenerateToken = () => {
    if (activeServer?.token) {
      if (type === 'tokens') {
        createToken({ server: activeServer, description: descriptionValue });
      } else {
        createAccess({ server: activeServer, description: descriptionValue });
      }
    }
  };

  const handleChangeSearch = (e) => {
    setSearchValue(e.target.value);
  };

  const handleChangeDescription = (e) => {
    setDescriptionValue(e.target.value);
  };

  const copyKey = async (key) => {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(key);
        snackbar.show({
          message: t('Copied'),
          type: 'success',
        });
      } catch (error) {
        console.error('Unable to copy text: ', error);
      }
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = key;
      document.body.appendChild(textArea);
      textArea.select();

      try {
        document.execCommand('copy');
        snackbar.show({
          message: t('Copied'),
          type: 'success',
        });
      } catch (error) {
        console.error('Unable to copy text: ', error);
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  const renderModalDescription = () => {
    if (type === 'tokens') {
      if (descriptionValue && createdTokenData.token) {
        return `Token Description: ${descriptionValue}`;
      }

      return 'Please provide a brief description as to the purpose of the API access token.';
    }

    if (descriptionValue && createdAccessData.access_id && createdAccessData.secret_key) {
      return `Description: ${descriptionValue}`;
    }

    return 'Please provide a brief description as to the purpose of the Access ID/Secret Key';
  };

  const renderInput = () => {
    if (type === 'tokens') {
      return (
        <div
          className={classNames(styles.modalDescriptionInputWrapper, {
            [styles.active]: !!createdTokenData.token || !!descriptionValue,
            [styles.withKey]: !!createdTokenData.token,
          })}
        >
          {createdTokenData.token && (
            <CopyIcon className={styles.clickableIcon} onClick={() => copyKey(createdTokenData.token)} />
          )}
          <input
            type="text"
            readOnly={!!createdTokenData.token}
            value={createdTokenData.token || descriptionValue}
            onChange={handleChangeDescription}
            className={styles.modalDescriptionInput}
            placeholder="Description"
          />
        </div>
      );
    }

    if (createdAccessData.access_id && createdAccessData.secret_key) {
      return (
        <div className={styles.keysContainer}>
          <p className={styles.keyTitle}>Access ID:</p>
          <div className={classNames(styles.modalDescriptionInputWrapper, styles.withKey, styles.active)}>
            <CopyIcon className={styles.clickableIcon} onClick={() => copyKey(createdAccessData.access_id)} />
            <input type="text" readOnly value={createdAccessData.access_id} className={styles.modalDescriptionInput} />
          </div>
          <p className={styles.keyTitle}>Secret Key:</p>
          <div className={classNames(styles.modalDescriptionInputWrapper, styles.withKey, styles.active)}>
            <CopyIcon className={styles.clickableIcon} onClick={() => copyKey(createdAccessData.secret_key)} />
            <input type="text" readOnly value={createdAccessData.secret_key} className={styles.modalDescriptionInput} />
          </div>
        </div>
      );
    }

    return (
      <div className={styles.modalDescriptionInputWrapper}>
        <input
          type="text"
          value={descriptionValue}
          onChange={handleChangeDescription}
          className={classNames(styles.modalDescriptionInput, {
            [styles.active]: !!(createdAccessData.access_id && createdAccessData.secret_key) || !!descriptionValue,
          })}
          placeholder="Description"
        />
      </div>
    );
  };

  const renderModalFooter = () => {
    if (type === 'tokens') {
      if (createdTokenData.message) {
        return <p className={styles.modalBottomWarning}>{createdTokenData.message}</p>;
      }

      return (
        <button className={styles.generateBtn} onClick={handleGenerateToken}>
          Generate Token
        </button>
      );
    }

    if (createdAccessData.access_id && createdAccessData.secret_key) {
      return <p className={styles.modalBottomWarning}>{createdAccessData.message}</p>;
    }

    return (
      <button className={styles.generateBtn} onClick={handleGenerateToken}>
        Generate Access ID
      </button>
    );
  };

  const addNewBtn = (
    <button className={styles.addNewBtn} onClick={() => setIsOpenModal(true)}>
      <span>{t('Add New')}</span>
      <AddCircleIcon />
    </button>
  );

  return (
    <>
      <div className={styles.securityTabHeader}>
        {isDesktop && (
          <>
            <h2 className={styles.accessIdsTitle}>{t(title)}</h2>
            {addNewBtn}
          </>
        )}
      </div>
      <p className={styles.description}>{description}</p>
      <hr className={styles.divider} />
      <div className={styles.toolbar}>
        <div className={styles.deleteSelected}>
          <p className={classNames(styles.count, { [styles.activeCount]: !!selectedRows.length })}>
            {selectedRows.length} {type === 'tokens' ? 'API Tokens' : 'Access IDs'} Selected
          </p>
          <button className={styles.deleteBtn} disabled={!selectedRows.length}>
            <TrashBinIcon />
            <span>{t('Delete')}</span>
          </button>
        </div>
        <div className={styles.searchContainer}>
          <SearchIcon className={classNames({ [styles.highlightSearchIcon]: !!searchValue })} />
          <input
            type="text"
            className={styles.search}
            placeholder="Search..."
            value={searchValue}
            onChange={handleChangeSearch}
          />
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          {headers.map((headerGroup) => (
            <tr key={headerGroup.id} className={styles.tableHeader}>
              {headerGroup.headers.map((header) => {
                return (
                  <th key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {!isDataLoading && (!tableData.length || fetchingError) && (
            <tr>
              <td colSpan={headers[0].headers.length}>
                <p className={styles.noMatchingResults}>
                  {fetchingError ? `Error: ${JSON.stringify(fetchingError)}` : t('No matching results')}
                </p>
              </td>
            </tr>
          )}
          {isDataLoading && (
            <tr>
              <td colSpan={headers[0].headers.length} className={styles.loaderContainer}>
                <Loader />
              </td>
            </tr>
          )}
          {!isDataLoading &&
            getRowModel().rows.map((row) => {
              return (
                <tr key={row.id} className={styles.tableRow}>
                  {row.getVisibleCells().map((cell) => {
                    return <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
      {!isDesktop && addNewBtn}
      <p className={styles.total}>
        {tableData.length} {type === 'tokens' ? 'API Access Token(s)' : 'Access ID(s)/Secret Key(s)'}
      </p>
      {isOpenModal && (
        <ModalNG
          isOpen={isOpenModal}
          title={type === 'tokens' ? 'Add New API Access Token' : 'Add New Access ID/Secret Key'}
          onClose={() => {
            setIsOpenModal(false);
            setDescriptionValue('');
          }}
          classes={{ content: styles.modalContent }}
        >
          <p className={styles.modalDescription}>{renderModalDescription()}</p>
          {renderInput()}
          {renderModalFooter()}
        </ModalNG>
      )}
    </>
  );
}

SecurityTabNG.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  type: PropTypes.oneOf(['tokens', 'ids']).isRequired,
};
