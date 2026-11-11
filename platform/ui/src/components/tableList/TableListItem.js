import { Component } from 'react';
import React from 'react';
import PropTypes from 'prop-types';

import { Icon } from './../../elements/Icon';

import './TableListItem.styl';

export class TableListItem extends Component {
  static propTypes = {
    children: PropTypes.node,
    itemClass: PropTypes.string,
    itemIndex: PropTypes.number,
    itemIndexStyle: PropTypes.object,
    itemMeta: PropTypes.node,
    itemMetaClass: PropTypes.string,
    itemKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    onItemClick: PropTypes.func.isRequired,
    // Wraps the index cell (a note that opens on the cell only); attributes of the cell
    renderItemIndex: PropTypes.func,
    itemIndexProps: PropTypes.object,
  };

  static defaultProps = {
    itemMeta: null,
    itemMetaClass: '',
  };

  render() {
    const itemIndex = (
      <div className={`itemIndex ${this.props.itemMetaClass}`} style={this.props.itemIndexStyle} {...this.props.itemIndexProps}>
        <div className="tableitem-index">{this.props.itemIndex}</div>
        {this.props.itemMeta}
        <span className="warning-icon">
          <Icon name="exclamation-triangle" />
        </span>
      </div>
    );
    return (
      <div className={`tableListItem ${this.props.itemClass}`} onClick={this.onItemClick}>
        {this.props.renderItemIndex ? this.props.renderItemIndex(itemIndex) : itemIndex}
        <div className="itemContent">{this.props.children}</div>
      </div>
    );
  }

  onItemClick = (event) => {
    if (this.props.onItemClick) {
      event.preventDefault();
      event.stopPropagation();

      this.props.onItemClick(event, this.props.itemKey);
    }
  };
}
