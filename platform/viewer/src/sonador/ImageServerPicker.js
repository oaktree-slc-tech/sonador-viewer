import React, { useState, Component } from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-modal';

import ImageServerPickerModal from './ImageServerPickerModal.js';

import SonadorDialogStyles from './SonadorStyles.js';

// Study List styles
import './ImageServerPicker.css';

export default class ImageServerPicker extends Component {
  // Change to a different Sonador server

  constructor(props) {
    super(props);
    this.state = {
      activeModalId: null,
    };
  }

  render() {
    const { activeServer, user } = this.props;

    // Event handlers
    const closeModal = () => this.setState({ activeModalId: null });
    const openModal = () =>
      this.setState({ activeModalId: 'SonadorImageServerPicker' });
    const onServerChange = token => this.props.onServerChange(token);

    return (
      <>
        <a className="control-link" onClick={openModal}>
          <span className="server-name">{activeServer.name}</span>
          <span className="caret-down"></span>
        </a>
        <ImageServerPickerModal
          user={user}
          isOpen={this.state.activeModalId === 'SonadorImageServerPicker'}
          onClose={closeModal}
          onServerChange={onServerChange}
        />
      </>
    );
  }
}

ImageServerPicker.propTypes = {
  // Required components and properties for image server picker
  user: PropTypes.object.isRequired,
  activeServer: PropTypes.object.isRequired,
  onServerChange: PropTypes.func,
};

ImageServerPicker.defaultProps = {
  // Default properties for image server picker
  activeServer: { name: 'Example' },
};
