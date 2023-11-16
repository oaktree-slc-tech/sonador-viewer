import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';

import initWebWorkers from './initWebWorkers.js';

describe('initWebWorkers', () => {
  it("initializes cornerstoneWADOImageLoader's web workers", () => {
    initWebWorkers();

    expect(cornerstoneWADOImageLoader.webWorkerManager.initialize).toHaveBeenCalled();
  });
});

describe('initWebWorkers', () => {
  it("initializes cornerstoneWADOImageLoader's web workers only once", () => {
    initWebWorkers();
    initWebWorkers();

    expect(cornerstoneWADOImageLoader.webWorkerManager.initialize).toHaveBeenCalledTimes(1);
  });
});
