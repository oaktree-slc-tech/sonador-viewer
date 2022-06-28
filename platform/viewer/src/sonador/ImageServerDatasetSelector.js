import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { withTranslation } from 'react-i18next';

import './ImageServerPickerModal.css'


class ImageServerDatasetSelector extends Component {
	// Switch to a different Sonador server

	switchServer = token => {
		this.props.switchServer(token);
		this.props.onServerChange(token);
	}

	render() {
		const { servers, activeServer, user } = this.props;

		return (<>
			<div className="modal-table-wrapper"><div className="modal-table">
				<div className="modal-table-header">
					<div className="modal-table-head">Name</div>
					<div className="modal-table-head">Type</div>
					<div className="modal-table-head">Active</div>
				</div>
				{servers.map((server, idx) => {
					return (
						<div className="modal-table-row" key={idx}>
							<div className="modal-table-cell">{server.name}</div>
							<div className="modal-table-cell">{server.type}</div>
							<div className="modal-table-cell" onClick={() => this.switchServer(server.token)}>
								{server.active ? String.fromCharCode(10003) : 'Switch'}</div>
						</div>
					);
				})}
			</div></div>
		</>)
	};
};


ImageServerDatasetSelector.propTypes = {
	user: PropTypes.object.isRequired,
	servers: PropTypes.array.isRequired,
	onServerChange: PropTypes.func,
};


export default withTranslation('Common')(ImageServerDatasetSelector);
