import React from 'react';

import { useSnackbarContext } from '../../contextProviders';

import SnackbarItem from './SnackbarItem';

import './Snackbar.css';

const SnackbarContainer = () => {
  const { snackbarItems, hide } = useSnackbarContext();

  const renderItem = (item) => {
    return <SnackbarItem key={item.itemId} options={item} onClose={hide} />;
  };

  if (!snackbarItems) {
    return null;
  }

  const renderItems = () => {
    const items = {
      topLeft: [],
      topCenter: [],
      topRight: [],
      bottomLeft: [],
      bottomCenter: [],
      bottomRight: [],
    };

    snackbarItems.forEach((item) => {
      items[item.position].push(item);
    });

    return (
      <div>
        {Object.keys(items).map((pos) => {
          if (!items[pos].length) {
            return null;
          }

          return (
            <div key={pos} className={`sb-container sb-${pos}`}>
              {items[pos].map((item, index) => (
                <div key={item.id + index}>{renderItem(item)}</div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return <>{renderItems()}</>;
};

export default SnackbarContainer;
