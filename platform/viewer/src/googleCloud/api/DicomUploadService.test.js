// The upload service's retry behaviour (imaging-development-env#103): a failed send goes to the back
// of the queue after a growing delay, up to the attempt budget; failures that cannot be helped by
// repeating are not retried; the callback reports every send with the file's standing.

jest.mock('dicomweb-client', () => ({ api: { DICOMwebClient: function () {} } }));
jest.mock('@ohif/core', () => ({ errorHandler: { getHTTPErrorHandler: () => () => {} } }));

import {
  DicomUploadService,
  NOT_VALID_DICOM_FILE_ERROR,
  describeUploadError,
  isRetryableUploadError,
} from './DicomUploadService';

const file = (fileId) => ({ fileId, name: `${fileId}.dcm` });
const httpError = (status) => Object.assign(new Error('request failed'), { status });

const run = async (outcomes, options = {}, token = { get: () => false }) => {
  // `outcomes[fileId]` lists what each send does, in order: null succeeds, an Error is thrown
  const service = new DicomUploadService();
  const sends = [];
  service.simpleUpload = jest.fn(async (f) => {
    sends.push(f.fileId);
    const next = outcomes[f.fileId].shift();
    if (next) throw next;
  });
  const reports = [];
  const success = jest.fn();
  await service.smartUpload(
    Object.keys(outcomes).map(id => file(Number(id))), 'http://server/dicom-web',
    (fileId, error, queue, status) => reports.push({ fileId, error, ...status }),
    token, { retryDelayMs: 1, success, ...options }
  );
  return { sends, reports, success };
};

describe('DicomUploadService.smartUpload retries', () => {
  it('retries a failed send from the back of the queue until it succeeds, reporting each send', async () => {
    const { sends, reports, success } = await run({
      0: [httpError(503), httpError(0), null],
      1: [null],
    }, { attempts: 5, workers: 1 });
    expect(sends).toEqual([0, 1, 0, 0]);
    expect(reports.map(r => [r.fileId, r.attempt, r.willRetry, r.error])).toEqual([
      [0, 1, true, 'HTTP 503'],
      [1, 1, false, null],
      [0, 2, true, 'Network error: the server could not be reached.'],
      [0, 3, false, null],
    ]);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('gives up once the attempt budget is spent and reports the last error as final', async () => {
    const { sends, reports } = await run({ 0: [httpError(500), httpError(500), httpError(500)] }, { attempts: 3 });
    expect(sends).toEqual([0, 0, 0]);
    const last = reports[reports.length - 1];
    expect(last).toMatchObject({ fileId: 0, attempt: 3, attempts: 3, willRetry: false, error: 'HTTP 500' });
    expect(reports.filter(r => r.willRetry)).toHaveLength(2);
  });

  it('does not retry a file that is not DICOM, nor a client error other than 408 and 429', async () => {
    const { sends, reports } = await run({
      0: [new Error(NOT_VALID_DICOM_FILE_ERROR)],
      1: [httpError(400)],
      2: [httpError(429), null],
    }, { attempts: 5, workers: 1 });
    expect(sends).toEqual([0, 1, 2, 2]);
    expect(reports.find(r => r.fileId === 0)).toMatchObject({ willRetry: false, error: NOT_VALID_DICOM_FILE_ERROR });
    expect(reports.find(r => r.fileId === 1)).toMatchObject({ willRetry: false, error: 'HTTP 400' });
    expect(reports.filter(r => r.fileId === 2).map(r => r.willRetry)).toEqual([true, false]);
  });

  it('waits a growing delay before each retry', async () => {
    const service = new DicomUploadService();
    const times = [];
    service.simpleUpload = jest.fn(async () => {
      times.push(Date.now());
      if (times.length < 3) throw httpError(502);
    });
    await service.smartUpload([file(0)], 'u', () => {}, { get: () => false }, { retryDelayMs: 20, attempts: 3 });
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(18);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(36);
  });

  it('a cancellation drops the scheduled retries and finishes without the success callback', async () => {
    const token = { value: false, get() { return this.value; }, set(v) { this.value = v; } };
    const service = new DicomUploadService();
    service.simpleUpload = jest.fn(async (f) => {
      if (f.fileId === 0) { token.set(true); throw httpError(503); }
    });
    const success = jest.fn();
    await service.smartUpload([file(0), file(1)], 'u', () => {}, token, { retryDelayMs: 1, attempts: 5, success });
    expect(service.simpleUpload).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });
});

describe('upload error helpers', () => {
  it('classifies and describes failures', () => {
    expect(isRetryableUploadError(httpError(500))).toBe(true);
    expect(isRetryableUploadError(httpError(0))).toBe(true);
    expect(isRetryableUploadError(httpError(408))).toBe(true);
    expect(isRetryableUploadError(httpError(403))).toBe(false);
    expect(isRetryableUploadError(new Error(NOT_VALID_DICOM_FILE_ERROR))).toBe(false);
    expect(describeUploadError(httpError(502))).toBe('HTTP 502');
    expect(describeUploadError(Object.assign(httpError(500), { response: '{"error":{"code":"E1","message":"disk full"}}' })))
      .toBe('HTTP 500: E1 - disk full');
    expect(describeUploadError(new Error('Failed to fetch'))).toBe('Failed to fetch');
  });
});
