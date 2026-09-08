// The request class thumbnails are loaded under, and the two call sites that have to use it.

const fs = require('fs');
const path = require('path');

const mockLoadAndCacheImage = jest.fn();

jest.mock('cornerstone-core', () => ({
  loadAndCacheImage: (...args) => mockLoadAndCacheImage(...args),
}));

import loadThumbnailImage, { THUMBNAIL_REQUEST_TYPE } from './loadThumbnailImage';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

// The two components that draw a thumbnail the user is waiting on.
const THUMBNAIL_CALL_SITES = [
  'platform/viewer/src/components/studyList/StudyItemExpandedNG/components/ImageThumbnailNG/logic.js',
  'platform/ui/src/components/studyBrowser/ImageThumbnail.js',
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadThumbnailImage', () => {
  it('classifies the request as a thumbnail', () => {
    // Without this the bridge maps an absent request type to Cornerstone3D's lowest class, and a
    // thumbnail queues as background prefetch.
    loadThumbnailImage('wadors:series/1');

    expect(mockLoadAndCacheImage).toHaveBeenCalledWith('wadors:series/1', {
      requestType: 'thumbnail',
    });
  });

  it('uses the name the legacy-to-Cornerstone3D mapping is keyed on', () => {
    // `bridgeImageLoader.toRequestType` looks this string up; a different spelling would fall
    // through to the prefetch class silently.
    expect(THUMBNAIL_REQUEST_TYPE).toBe('thumbnail');
  });

  it('returns what the loader returns', () => {
    const image = { imageId: 'wadors:series/1' };
    mockLoadAndCacheImage.mockReturnValue(Promise.resolve(image));

    return expect(loadThumbnailImage('wadors:series/1')).resolves.toBe(image);
  });
});

describe('the thumbnail call sites', () => {
  // A source check, because neither call site can be executed here: one is a react-query hook and
  // there is no React renderer in this repository, and the other is a component. What matters is
  // that neither of them asks for an image without saying what it is for.
  THUMBNAIL_CALL_SITES.forEach(relativePath => {
    it(`${relativePath} goes through the helper`, () => {
      const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

      expect(source).toMatch(/loadThumbnailImage\(/);
      expect(source).not.toMatch(/loadAndCacheImage\(/);
    });
  });
});
