import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Icon } from '@ohif/ui';

import './googleCloud.css';

const DicomStoreList = ({ stores, loading = true, error, onSelect, filter }) => {
  const { t } = useTranslation('Common');

  const [highlightedItem, setHighlightedItem] = useState('');

  const renderTableRow = (store) => (
    <tr
      key={store.name}
      className={highlightedItem === store.name ? 'noselect active' : 'noselect'}
      onMouseEnter={() => onHighlightItem(store.name)}
      onClick={() => onSelect(store)}
    >
      <td className="project">{store.name.split('/')[7]}</td>
    </tr>
  );

  const onHighlightItem = (store) => {
    setHighlightedItem(store);
  };

  if (error) {
    return <p>{error}</p>;
  }

  const loadingIcon = <Icon name="circle-notch" className="loading-icon-spin loading-icon" />;

  if (loading) {
    return loadingIcon;
  }

  const body = (
    <tbody id="StoreList">
      {stores
        .filter((store) => store.name.split('/')[7].toLowerCase().includes(filter.toLowerCase()) || filter === '')
        .map(renderTableRow)}
    </tbody>
  );

  return (
    <table id="tblStoreList" className="gcp-table table noselect">
      <thead>
        <tr>
          <th>{t('DICOM Store')}</th>
        </tr>
      </thead>
      {stores && body}
    </table>
  );
};

DicomStoreList.propTypes = {
  stores: PropTypes.array,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onSelect: PropTypes.func,
  filter: PropTypes.string,
};

export default DicomStoreList;
