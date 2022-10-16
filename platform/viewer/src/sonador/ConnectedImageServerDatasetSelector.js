import { connect } from 'react-redux';
import { switchServerActionCreator } from '@ohif/core/src/redux/reducers/servers';

import ImageServerDatasetSelector from './ImageServerDatasetSelector.js';

const mapStateToProps = state => {
  return {
    user: state.oidc && state.oidc.user,
    servers: state.servers.servers,
  };
};

const mapDispatchToProps = dispatch => {
  return {
    switchServer: token => {
      let action = switchServerActionCreator(token);
      dispatch(action);
    },
  };
};

const ConnectedImageServerDatasetSelector = connect(
  mapStateToProps,
  mapDispatchToProps
)(ImageServerDatasetSelector);

export default ConnectedImageServerDatasetSelector;
