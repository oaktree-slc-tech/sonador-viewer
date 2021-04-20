import Header from '../components/Header/Header.js';
import { connect } from 'react-redux';
import { swithServerActionCreator } from '@ohif/core/src/redux/reducers/servers';

const mapStateToProps = state => {
  return {
    user: state.oidc && state.oidc.user,
    servers: state.servers.servers,
  };
};

const mapDispatchToProps = dispatch => {
  return {
    switchServer: token => {
      let action = swithServerActionCreator(token);
      dispatch(action);
    },
  };
};

const ConnectedHeader = connect(
  mapStateToProps,
  mapDispatchToProps
)(Header);

export default ConnectedHeader;
