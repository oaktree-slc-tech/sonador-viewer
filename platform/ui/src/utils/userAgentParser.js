export const parseUserAgent = () => {
  // Get the user agent string
  const userAgent = navigator.userAgent;

  let osName = 'Unknown';
  let osVersion = 'Unknown';

  if (/Windows/.test(userAgent)) {
    osName = 'Windows';
    osVersion = /Windows NT (\d+\.\d+)/.exec(userAgent)[1];
  } else if (/Mac OS X/.test(userAgent)) {
    osName = 'Mac OS X';
    const versionMatch = /Mac OS X (\d+[\._]\d+)/.exec(userAgent);
    if (versionMatch) {
      osVersion = versionMatch[1].replace('_', '.');
    }
  } else if (/Linux/.test(userAgent)) {
    osName = 'Linux';
  } else if (/Android/.test(userAgent)) {
    osName = 'Android';
    osVersion = /Android (\d+(\.\d+)?)/.exec(userAgent)[1];
  } else if (/iPhone|iPod|iPad/.test(userAgent)) {
    osName = 'iOS';
    const versionMatch = /OS (\d+[\._]\d+)/.exec(userAgent);
    if (versionMatch) {
      osVersion = versionMatch[1].replace('_', '.');
    }
  }

  let browserName = 'Unknown';
  let browserVersion = 'Unknown';

  if (/Chrome/.test(userAgent)) {
    browserName = 'Google Chrome';
    browserVersion = /Chrome\/(\d+\.\d+)/.exec(userAgent)[1];
  } else if (/Firefox/.test(userAgent)) {
    browserName = 'Mozilla Firefox';
    browserVersion = /Firefox\/(\d+\.\d+)/.exec(userAgent)[1];
  } else if (/Safari/.test(userAgent)) {
    browserName = 'Safari';
    browserVersion = /Version\/(\d+\.\d+)/.exec(userAgent)[1];
  } else if (/Edge/.test(userAgent)) {
    browserName = 'Microsoft Edge';
    browserVersion = /Edg\/(\d+\.\d+)/.exec(userAgent)[1];
  } else if (/Trident/.test(userAgent)) {
    browserName = 'Internet Explorer';
    browserVersion = /rv:(\d+\.\d)/.exec(userAgent)[1];
  }

  return { osName, osVersion, browserName, browserVersion };
};
