import { connect } from 'react-redux';

import Header from '../components/Header/Header.js';

const mapStateToProps = (state) => {
  return {
    user: state.oidc && state.oidc.user,
    servers: state.servers.servers,
  };
};

const ConnectedHeader = connect(mapStateToProps)(Header);

export default ConnectedHeader;
