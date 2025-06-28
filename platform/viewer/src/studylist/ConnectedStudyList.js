import { connect } from 'react-redux';
import OHIF from '@ohif/core';

import StudyListRoute from './StudyListRoute';

const { sonador } = OHIF;


const mapStateToProps = (state) => {
  // Map Redux state to component properties for the study list

  const activeServer = sonador.getActiveServer(state.servers.servers);

  return {
    server: activeServer,
    user: state.oidc.user,
  };
};


const ConnectedStudyList = connect(mapStateToProps, null)(StudyListRoute);


export default ConnectedStudyList;
