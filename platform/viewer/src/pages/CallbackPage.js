import React from 'react';
import { useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import { CallbackComponent } from 'redux-oidc';

const CallbackPage = ({ userManager }) => {
  const navigate = useNavigate();
  const handleSuccess = () => {
    const { pathname, search = '' } = JSON.parse(sessionStorage.getItem('ohif-redirect-to'));
    navigate({ pathname, search });
  };

  const handleError = (error) => {
    throw new Error(error);
  };

  return (
    <CallbackComponent userManager={userManager} successCallback={handleSuccess} errorCallback={handleError}>
      <div>Redirecting...</div>
    </CallbackComponent>
  );
};

CallbackPage.propTypes = {
  userManager: PropTypes.object.isRequired,
};

export default CallbackPage;
