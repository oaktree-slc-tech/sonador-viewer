import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import classNames from 'classnames';
import moment from 'moment';

import { useSnackbarContext } from '@ohif/ui';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as AddCircleIcon } from '@ohif/ui/src/elements/Svg/svgs/add-circle.svg';
import { ReactComponent as CopyIcon } from '@ohif/ui/src/elements/Svg/svgs/copy.svg';
import { ReactComponent as SearchIcon } from '@ohif/ui/src/elements/Svg/svgs/search.svg';
import { ReactComponent as TrashBinIcon } from '@ohif/ui/src/elements/Svg/svgs/trash-bin.svg';

import { useDeviceStore } from '../../../../store/useDeviceStore';

import { useAccesses, useCreateAccess, useDeleteAccess } from './logic';

import globalTableStyles from '../../../../styles/globalTableStyles.module.scss';
import styles from '../SecurityTabNG/SecurityTabNG.module.scss';

/**
 *
 * @param {boolean} isMobile
 * @param {function} onDeleteAccess
 * @returns {[{header: (function({table: *}): *), id: string, cell: (function({row: *}): *)},{header: string, id: string, cell: (function({getValue: *}): string), accessorKey: string},{header: string, id: string, accessorKey: string},{header: string, id: string, cell: (function({getValue: *}): string), accessorKey: string}]}
 */
const getColumns = (isMobile, onDeleteAccess) => {
  const columns = [
    {
      header: 'Access ID',
      id: 'access_id',
      accessorKey: 'access_id',
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
      cell: ({ getValue, row }) => {
        return (
          <div className={styles.createdColumn}>
            <p>{moment(getValue()).format('MMM DD, YYYY, hh:mm a')}</p>
            <button className={styles.deleteBtn} onClick={() => onDeleteAccess(row.original.access_id)}>
              <TrashBinIcon />
            </button>
          </div>
        );
      },
    },
  ];

  if (isMobile) {
    return columns.filter(({ id }) => id !== 'description');
  }

  return columns;
};

export default function SecurityAccessIdsTabNG() {
  const { t } = useTranslation();

  const [searchValue, setSearchValue] = useState('');
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');

  const { isDesktop, isMobile } = useDeviceStore();

  const { data: accesses = [], isLoading: isLoadingAccesses, error: idsError } = useAccesses();
  const { mutate: createAccess, data: createdAccessData = {} } = useCreateAccess();
  const { mutate: deleteAccess } = useDeleteAccess();

  const snackbar = useSnackbarContext();

  // NOTE: `data` and `columns` MUST be referentially stable across renders.
  // Passing a freshly-built array on every render sends @tanstack/react-table into an
  // infinite re-render loop under React 18's concurrent renderer (createRoot) the moment
  // any state update (e.g. opening the "Add New" modal) occurs. It tolerated unstable
  // references under React 16's legacy renderer, which is why this only broke after the
  // React upgrade.
  const tableData = useMemo(
    () =>
      accesses.filter((item) => {
        const lowerCasedSearch = searchValue.toLowerCase();

        return (
          item.description?.toLowerCase().includes(lowerCasedSearch) ||
          item.access_id?.toLowerCase().includes(lowerCasedSearch) ||
          (item.ctime
            ? moment(item.ctime)?.format('MMM DD, YYYY, hh:mm a')?.toLowerCase().includes(lowerCasedSearch)
            : false)
        );
      }),
    [accesses, searchValue]
  );

  const handleDeleteAccess = useCallback((accessId) => {
    deleteAccess(accessId);
  }, [deleteAccess]);

  const columns = useMemo(() => getColumns(isMobile, handleDeleteAccess), [isMobile, handleDeleteAccess]);

  const { getHeaderGroups, getRowModel } = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const headers = getHeaderGroups();

  const handleGenerateToken = () => {
    createAccess(descriptionValue);
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
    if (descriptionValue && createdAccessData.access_id && createdAccessData.secret_key) {
      return `Description: ${descriptionValue}`;
    }

    return 'Please provide a brief description as to the purpose of the Access ID/Secret Key';
  };

  const renderInput = () => {
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

  const addNewBtn = (
    <button className={styles.addNewBtn} onClick={() => setIsOpenModal(true)}>
      <AddCircleIcon />
      <span>{t('Add New')}</span>
    </button>
  );

  return (
    <>
      <div className={styles.securityTabHeader}>
        {isDesktop && (
          <>
            <h2 className={styles.accessIdsTitle}>{t('Access IDs/Secret Keys')}</h2>
            {addNewBtn}
          </>
        )}
      </div>
      <p className={globalTableStyles.description}>
        Access IDs can be used to grant other systems to access additional API functions. Access IDs/Secret Keys should
        never be exposed to the public, such as front-end code or GitHub. They should be kept secret as they can be used
        to access this website with your account.
      </p>
      <hr className={styles.divider} />
      <div className={styles.toolbar}>
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
          {!isLoadingAccesses && (!tableData.length || idsError) && (
            <tr>
              <td colSpan={headers[0].headers.length}>
                <p className={globalTableStyles.noMatchingResults}>
                  {idsError ? `Error: ${JSON.stringify(idsError)}` : t('No matching results')}
                </p>
              </td>
            </tr>
          )}
          {!isLoadingAccesses &&
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
      {isLoadingAccesses && (
        <div className={styles.loaderContainer}>
          <Loader />
        </div>
      )}
      {!isDesktop && addNewBtn}
      <p className={styles.total}>{tableData.length} Access ID(s)/Secret Key(s)</p>
      {isOpenModal && (
        <ModalNG
          isOpen={isOpenModal}
          title="Add New Access ID/Secret Key"
          onClose={() => {
            setIsOpenModal(false);
            setDescriptionValue('');
          }}
          classes={{ content: styles.modalContent }}
        >
          <p className={styles.modalDescription}>{renderModalDescription()}</p>
          {renderInput()}
          {createdAccessData.access_id && createdAccessData.secret_key ? (
            <p className={styles.modalBottomWarning}>{createdAccessData.message}</p>
          ) : (
            <button className={styles.generateBtn} onClick={handleGenerateToken}>
              Generate Access ID
            </button>
          )}
        </ModalNG>
      )}
    </>
  );
}
