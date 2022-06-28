import Header from '../components/Header/Header.js';
import { connect } from 'react-redux';

const mapStateToProps = state => {
  return {
    user: state.oidc && state.oidc.user,
    servers: state.servers.servers,
  };
};


const ConnectedHeader = connect(
  mapStateToProps,
)(Header);


export default ConnectedHeader;
