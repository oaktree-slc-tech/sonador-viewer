/**
 * @jest-environment ./src/__tests__/jsdomEnvironment.js
 */
// The legacy modal uploader (reachable under /legacy) against the upload service's callback contract
// (imaging-development-env#103): the callback it registers with smartUpload forwards the service's
// status, and the rows render the reported retry and terminal states with the configured budget.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
jest.mock('./api/DicomUploadService', () => ({
  __esModule: true,
  default: { smartUpload: jest.fn(), setRetrieveAuthHeaderFunction: jest.fn() },
}));

import dicomUploader from './api/DicomUploadService';
import DicomUploader from './DicomUploader';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];
function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<DicomUploader url="http://server/dicom-web" retrieveAuthHeaderFunction={() => ({})} />);
  });
  mounted.push({ root, host });
  return host;
}
afterEach(() => {
  while (mounted.length) {
    const { root, host } = mounted.pop();
    act(() => root.unmount());
    host.remove();
  }
  dicomUploader.smartUpload.mockReset();
});

const selectFiles = (host, files) => {
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const file = (name, size = 10) => {
  const f = new File([new Uint8Array(size)], name, { type: 'application/dicom' });
  return f;
};

describe('DicomUploader (legacy) and the upload service contract', () => {
  it('forwards the full callback contract and renders retrying, exhausted and non-retryable states from it', async () => {
    const host = mount();
    selectFiles(host, [file('a.dcm'), file('b.dcm'), file('c.dcm')]);
    expect(dicomUploader.smartUpload).toHaveBeenCalledTimes(1);
    const [, , uploadCb] = dicomUploader.smartUpload.mock.calls[0];
    // Forwards every argument the service passes, status included
    expect(uploadCb.length).toBe(4);

    // Drive the callback as the service would
    const report = (fileId, error, status) => act(() => {
      uploadCb(fileId, error, [], status);
    });
    report(0, 'HTTP 503', { attempt: 1, attempts: 3, willRetry: true, retryDelayMs: 500 });
    report(1, 'HTTP 500', { attempt: 3, attempts: 3, willRetry: false, retryDelayMs: 0 });
    report(2, 'This is not a valid DICOM file.', { attempt: 1, attempts: 3, willRetry: false, retryDelayMs: 0 });

    // The rows are behind the details toggle
    const toggle = host.querySelector('.toggle-details');
    expect(toggle.textContent).toContain('Show Details');
    act(() => {
      toggle.click();
    });

    const text = host.textContent;
    // Retrying with the service's budget, not a fixed one
    expect(text).toContain('Error & Retry');
    expect(text).toContain('1/3');
    // Terminal failures are failures, however many attempts they took
    expect(text).toContain('Error/Failed');
    expect(text).toContain('3/3');
    expect(text).not.toContain('/100');

    // The retried file succeeds on its second send
    report(0, null, { attempt: 2, attempts: 3, willRetry: false, retryDelayMs: 0 });
    expect(host.textContent).toContain('Successful');
  });
});
