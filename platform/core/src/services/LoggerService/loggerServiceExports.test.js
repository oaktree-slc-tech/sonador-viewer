// Shape of the logging exports, pinned because getting it wrong is silent.
//
// `@ohif/core` exports some services as a ready-to-use INSTANCE (`uiNotificationService`,
// `notificationLogService`) and others as a service DESCRIPTOR that the ServicesManager still has
// to `create()` (`LoggerService`, `UINotificationService`). Both spellings are importable from the
// same barrel and look interchangeable at the call site.
//
// A caller that imported the descriptor and called `LoggerService.info(...)` threw "info is not a
// function" at runtime only, on a path that had no test and sat inside a try block, so the failure
// surfaced as an unrelated ACL error (bulk share). These assertions make the distinction explicit.

import LoggerService from './index';
import { notificationLogService } from '../NotificationLogService';

// Jest 29 runs in a node environment here (jest-environment-jsdom is not installed), and
// PubSubService._broadcastEvent mirrors every event onto document.body as a CustomEvent. Same
// shims as LocalCacheService.test.js.
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };


describe('LoggerService module export', () => {
  it('is a service descriptor, NOT the logging API', () => {
    // If this ever starts exposing `info` directly, the comment in useBulkShare explaining why it
    // does not can go -- but until then, `LoggerService.info` from the barrel is a bug.
    expect(typeof LoggerService.create).toBe('function');
    expect(LoggerService.info).toBeUndefined();
    expect(LoggerService.error).toBeUndefined();
  });

  it('yields the logging API only once created', () => {
    const api = LoggerService.create({ configuration: {} });

    expect(typeof api.info).toBe('function');
    expect(typeof api.error).toBe('function');
  });
});


describe('notificationLogService module export', () => {
  it('is a ready instance, so producers can record without a ServicesManager', () => {
    // This is what the bulk-share audit entries are written through.
    expect(typeof notificationLogService.add).toBe('function');
    expect(typeof notificationLogService.getEntries).toBe('function');
  });

  it('records an entry and returns its id', () => {
    const id = notificationLogService.add({
      title: 'Access granted',
      message: 'Radiology was granted View on Study 1',
      severity: 'success',
      studyInstanceUID: '1.2.3',
    });

    expect(id).toBeTruthy();
    expect(
      notificationLogService.getEntries({ studyInstanceUID: '1.2.3' }).some(
        (entry) => entry.title === 'Access granted'
      )
    ).toBe(true);

    notificationLogService.clear({ studyInstanceUID: '1.2.3' });
  });
});
