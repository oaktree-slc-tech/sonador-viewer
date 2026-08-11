import { useSelector } from 'react-redux';

import { redux } from '@ohif/core';

import { useAppContext } from '../context/AppContext';
import useServerSystemInfo from './useServerSystemInfo';

/**
 * Versions and addresses of the Sonador components this session is connected to, for the About
 * panel. Each comes from a different place:
 *
 *   * Sonador URL and API version -- the application configuration document loaded at startup.
 *   * Imaging server URL -- the active server in the Redux server list.
 *   * Orthanc and cloud plugin versions -- that server's `/system` report.
 *
 * @returns {Object} `{ sonadorUrl, sonadorVersion, imagingServerUrl, imagingServerVersion,
 *   cloudPluginVersion, activeServer, isLoading, error }`. Version fields are `undefined` when not
 *   known; `isLoading` separates "still fetching" from "no answer".
 */
export default function usePlatformVersions() {
  const { appConfig = {} } = useAppContext();
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);
  const { sysInfo, isLoading, error } = useServerSystemInfo(activeServer);

  // `typeof` guarded rather than `window?.`: optional chaining still throws a ReferenceError on an
  // undeclared identifier, and this module is loaded under jest's node environment.
  const sonadorHost = typeof window === 'undefined' ? undefined : window.sonador?.host;

  return {
    // The config document carries `sonadorUrl`; `window.sonador.host` is set separately by the
    // Django viewer shell and the PWA config file. Either identifies the same deployment.
    sonadorUrl: appConfig.sonadorUrl || sonadorHost,
    sonadorVersion: appConfig.sonadorVersion,
    imagingServerUrl: activeServer?.rootUrl,
    imagingServerVersion: sysInfo?.Version,
    cloudPluginVersion: sysInfo?.SonadorVersion,
    activeServer,
    isLoading,
    error,
  };
}

export { usePlatformVersions };
