import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';

import { Icon } from './../../elements/Icon';

class PageToolbar extends PureComponent {
  static propTypes = {
    onImport: PropTypes.func,
  };

  onImport = (event) => {
    if (this.props.onImport) {
      this.props.onImport(event);
    }
  };

  getImportTool() {
    if (this.props.onImport) {
      return (
        <div className="addNewStudy btn-file">
          <label htmlFor="btnImport" style={{ width: '24px' }} onClick={this.onImport}>
            <Icon name="plus" />
          </label>
        </div>
      );
    }
  }

  render() {
    return <div className="studylistToolbar">{this.getImportTool()}</div>;
  }
}

export { PageToolbar };
