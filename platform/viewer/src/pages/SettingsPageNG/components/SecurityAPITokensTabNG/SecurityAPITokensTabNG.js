import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
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

import { useCsrfToken } from '../../../../hooks/useCsrfToken';
import { useDeviceStore } from '../../../../store/useDeviceStore';

import { useCreateToken, useTokens } from './logic';

import styles from '../SecurityTabNG/SecurityTabNG.module.scss';

/**
 *
 * @param {boolean} isMobile
 * @returns {[{header: (function({table: *}): *), id: string, cell: (function({row: *}): *)},{header: string, id: string, cell: (function({getValue: *}): string), accessorKey: string},{header: string, id: string, accessorKey: string},{header: string, id: string, cell: (function({getValue: *}): string), accessorKey: string}]}
 */
const getColumns = (isMobile) => {
  const columns = [
    {
      header: 'Access Token',
      id: 'token',
      accessorKey: 'token',
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
      cell: ({ getValue }) => {
        return (
          <div className={styles.createdColumn}>
            <p>{moment(getValue()).format('MMM DD, YYYY, hh:mm a')}</p>
            <button className={styles.deleteBtn}>
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

export default function SecurityAPITokensTabNG() {
  const { t } = useTranslation();

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [searchValue, setSearchValue] = useState('');
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');

  const { isDesktop, isMobile } = useDeviceStore();

  const { data: csrfTokenData } = useCsrfToken({ server: activeServer });
  const {
    data: tokens = [],
    isLoading: isLoadingTokens,
    error: tokensError,
  } = useTokens({
    server: activeServer,
  });

  const { mutate: createToken, data: createdTokenData = {} } = useCreateToken();

  const snackbar = useSnackbarContext();

  const tableData = tokens.filter((item) => {
    const lowerCasedSearch = searchValue.toLowerCase();

    return (
      item.description?.toLowerCase().includes(lowerCasedSearch) ||
      item.access_id.toLowerCase().includes(lowerCasedSearch)
    );
  });

  const { getHeaderGroups, getRowModel } = useReactTable({
    data: tableData,
    columns: getColumns(isMobile),
    getCoreRowModel: getCoreRowModel(),
  });

  const headers = getHeaderGroups();

  const handleGenerateToken = () => {
    if (activeServer?.token && csrfTokenData?.csrf_token) {
      createToken({ server: activeServer, description: descriptionValue, csrfToken: csrfTokenData.csrf_token });
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
    if (descriptionValue && createdTokenData.token) {
      return `Token Description: ${descriptionValue}`;
    }

    return 'Please provide a brief description as to the purpose of the API access token.';
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
            <h2 className={styles.accessIdsTitle}>{t('API Access Tokens')}</h2>
            {addNewBtn}
          </>
        )}
      </div>
      <p className={styles.description}>
        API Access tokens can be used to grant other systems to access additional API functions. API keys should never
        be exposed to the public, such as front-end code or GitHub. They should be kept secret as they can be used to
        access this website with your account.
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
          {!isLoadingTokens && (!tableData.length || tokensError) && (
            <tr>
              <td colSpan={headers[0].headers.length}>
                <p className={styles.noMatchingResults}>
                  {tokensError ? `Error: ${JSON.stringify(tokensError)}` : t('No matching results')}
                </p>
              </td>
            </tr>
          )}
          {!isLoadingTokens &&
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
      {isLoadingTokens && (
        <div className={styles.loaderContainer}>
          <Loader />
        </div>
      )}
      {!isDesktop && addNewBtn}
      <p className={styles.total}>{tableData.length} API Access Token(s)</p>
      {isOpenModal && (
        <ModalNG
          isOpen={isOpenModal}
          title="Add New API Access Token"
          onClose={() => {
            setIsOpenModal(false);
            setDescriptionValue('');
          }}
          classes={{ content: styles.modalContent }}
        >
          <p className={styles.modalDescription}>{renderModalDescription()}</p>
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
          {createdTokenData.message ? (
            <p className={styles.modalBottomWarning}>{createdTokenData.message}</p>
          ) : (
            <button className={styles.generateBtn} onClick={handleGenerateToken}>
              Generate Token
            </button>
          )}
        </ModalNG>
      )}
    </>
  );
}
