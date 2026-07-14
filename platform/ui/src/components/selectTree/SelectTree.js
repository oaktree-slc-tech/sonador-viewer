import React, { useState } from 'react';
import { cloneDeep } from 'lodash';
import PropTypes from 'prop-types';

import { Icon } from './../../elements/Icon';
import InputRadio from './InputRadio.js';
import SelectTreeBreadcrumb from './SelectTreeBreadcrumb.js';

import './SelectTree.styl';

function SelectTree({
  autoFocus = true,
  searchEnabled = true,
  selectTreeFirstTitle = 'First Level itens',
  selectTreeSecondTitle,
  searchPlaceholder = 'Search labels',
  items,
  onSelected,
}) {
  const [searchTerm, setSearchTerm] = useState(null);
  const [currentNode, setCurrentNode] = useState(null);

  const isLeafSelected = (item) => item && !Array.isArray(item.items);

  const handleSelected = (event, item) => {
    if (isLeafSelected(item)) {
      setSearchTerm(null);
      setCurrentNode(null);
    } else {
      setCurrentNode(item);
    }

    if (onSelected) {
      onSelected(event, item);
    }
  };

  const getLabelClass = (item) => {
    let labelClass = 'treeLeaf';
    if (searchTerm || Array.isArray(item.items)) {
      labelClass = 'treeNode';
    }
    return labelClass;
  };

  const filterItems = () => {
    const filteredItems = [];
    const rawItems = cloneDeep(items);

    rawItems.forEach((item) => {
      if (Array.isArray(item.items)) {
        item.items.forEach((childItem) => {
          const label = childItem.label.toLowerCase();
          const lowercasedSearchTerm = searchTerm.toLowerCase();
          if (label.indexOf(lowercasedSearchTerm) !== -1) {
            filteredItems.push(childItem);
          }
        });
      } else {
        const label = item.label.toLowerCase();
        const lowercasedSearchTerm = searchTerm.toLowerCase();
        if (label.indexOf(lowercasedSearchTerm) !== -1) {
          filteredItems.push(item);
        }
      }
    });

    return filteredItems;
  };

  let treeItems;

  if (searchTerm) {
    treeItems = filterItems();
  } else if (currentNode) {
    treeItems = cloneDeep(currentNode.items);
  } else {
    treeItems = cloneDeep(items);
  }

  const searchLocations = (evt) => {
    setSearchTerm(evt.currentTarget.value);
    setCurrentNode(null);
  };

  const onBreadcrumbSelected = () => {
    setCurrentNode(null);
  };

  return (
    <div className="selectTree selectTreeRoot">
      <div className="treeContent">
        <div className="wrapperLabel treeHeader">
          <div className="wrapperText">{currentNode ? selectTreeSecondTitle : selectTreeFirstTitle}</div>
          {searchEnabled && (
            <div className="wrapperSearch">
              <div className="searchIcon">
                <Icon name="search" />
              </div>
              <input
                type="text"
                className="searchInput"
                placeholder={searchPlaceholder}
                autoFocus={autoFocus}
                onChange={searchLocations}
                value={searchTerm || ''}
              />
            </div>
          )}
        </div>
        <div className="treeOptions">
          {currentNode && (
            <SelectTreeBreadcrumb
              onSelected={onBreadcrumbSelected}
              label={currentNode.label}
              value={currentNode.value}
            />
          )}
          <div className="treeInputsWrapper">
            <div className="treeInputs">
              {treeItems.map((item, index) => {
                return (
                  <InputRadio
                    key={currentNode ? currentNode.value : index}
                    id={`SelectTree_${item.value}`}
                    name={index}
                    itemData={item}
                    value={item.value}
                    label={item.label}
                    labelClass={getLabelClass(item)}
                    onSelected={handleSelected}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


SelectTree.propTypes = {
  autoFocus: PropTypes.bool,
  searchEnabled: PropTypes.bool,
  selectTreeFirstTitle: PropTypes.string,
  selectTreeSecondTitle: PropTypes.string,
  searchPlaceholder: PropTypes.string,
  items: PropTypes.array.isRequired,
  onSelected: PropTypes.func.isRequired,
};



export default SelectTree;
