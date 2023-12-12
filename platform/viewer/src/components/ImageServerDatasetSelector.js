import React from 'react';
import PropTypes from 'prop-types';

import './ImageServerPickerModal/ImageServerPickerModal.css';

const ImageServerDatasetSelector = ({ servers, switchServer, onServerChange }) => {
  const handleSwitchServer = (token) => {
    switchServer(token);
    onServerChange(token);
  };

  return (
    <>
      <div className="modal-table-wrapper">
        <div className="modal-table">
          <div className="modal-table-header">
            <div className="modal-table-head">Name</div>
            <div className="modal-table-head">Type</div>
            <div className="modal-table-head">Active</div>
          </div>
          {servers.map((server, idx) => (
            <div className="modal-table-row" key={idx}>
              <div className="modal-table-cell">{server.name}</div>
              <div className="modal-table-cell">{server.type}</div>
              <div className="modal-table-cell" onClick={() => handleSwitchServer(server.token)}>
                {server.active ? String.fromCharCode(10003) : 'Switch'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

ImageServerDatasetSelector.propTypes = {
  servers: PropTypes.array.isRequired,
  onServerChange: PropTypes.func,
  switchServer: PropTypes.func.isRequired,
};

export default ImageServerDatasetSelector;
