import React, { useState } from 'react';
import PropTypes from 'prop-types';

import ImageServerPickerModal from '../ImageServerPickerModal/ImageServerPickerModal';

// Study List styles
import './ImageServerPicker.css';

const ImageServerPicker = ({ activeServer = { name: 'Example' }, user, onServerChange }) => {
  const [activeModalId, setActiveModalId] = useState(null);

  // Event handlers
  const closeModal = () => setActiveModalId(null);
  const openModal = () => setActiveModalId('SonadorImageServerPicker');

  return (
    <>
      <a className="control-link" onClick={openModal}>
        <span className="server-name">{activeServer.name}</span>
        <span className="caret-down"></span>
      </a>
      <ImageServerPickerModal
        user={user}
        isOpen={activeModalId === 'SonadorImageServerPicker'}
        onClose={closeModal}
        onServerChange={onServerChange}
      />
    </>
  );
};

ImageServerPicker.propTypes = {
  // Required components and properties for image server picker
  user: PropTypes.object.isRequired,
  activeServer: PropTypes.object.isRequired,
  onServerChange: PropTypes.func,
};


export default ImageServerPicker;
