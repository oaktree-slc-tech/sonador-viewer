// Keyboard reachability and activation of the Retry control on a failed transfer (#131 FR-5/FR-7).
//
// PREREQUISITES: the viewer served at `baseUrl`, a session that reaches the study list, and at
// least one study in the table. Run with `yarn test:e2e:sonador` from platform/viewer, which pins
// `--browser chrome` -- `cy.realTab` dispatches through the DevTools protocol, so it needs a
// Chromium-family browser.
//
// The suite ALSO needs the Cypress project itself migrated to the v10+ layout: the installed
// Cypress is 13.x, which rejects `cypress.json` and the `cypress/integration` directory this file
// lives in. That migration is repo infrastructure, not part of this feature.
//
// UNLIKE OfflineStorageInteraction.spec.js, these cases do not reach the control under test with
// `.focus()`. `.focus()` sets only the STARTING point -- the row's own trigger -- and every step
// from there is a real Tab press delivered by the browser. So what is asserted is that the control
// is in the sequential focus order, not merely that it can hold focus. That distinction is the
// whole point of the control being `aria-disabled` instead of `disabled`: a `disabled` button is
// skipped by the browser, and the explanation of why Retry is unavailable would be unreachable
// without a pointer.
//
// Enter AND Space are exercised on both sides. A negative assertion alone ("Space did not activate
// it") would pass just as well if the helper never generated a usable Space at all.
//
// Both jobs are driven into ERROR through the real pipeline -- enqueue, then a 500 on the series
// query the enumeration makes -- rather than by writing job state directly. One is enqueued against
// a server that is not the active one, which is the FR-7 condition the control refuses.

const OTHER_SERVER = {
  wadoRoot: 'https://not-the-active-server.invalid/dicom-web',
  qidoRoot: 'https://not-the-active-server.invalid/dicom-web',
};

const RETRY = '[data-cy="offline-transfer-retry"]';

function downloadService(win) {
  const service = win.ohif?.app?.servicesManager?.services?.downloadManagerService;
  if (!service) {
    throw new Error('downloadManagerService is not registered; the app has not finished booting.');
  }
  return service;
}

function activeServer(win) {
  return win.store.getState().servers?.servers?.find(s => s.active);
}

/** The transfer row whose Retry control carries `aria-disabled="<state>"`. */
function rowFor(state) {
  return cy
    .get('[data-cy="offline-transfer-row"]')
    .parent()
    .filter(`:has(${RETRY}[aria-disabled="${state}"])`);
}

/** The text a control's `aria-describedby` resolves to -- its accessible description. */
function accessibleDescription($control) {
  const id = $control.attr('aria-describedby');
  expect(id, 'the control names a description element').to.be.a('string').and.not.be.empty;

  const description = Cypress.$(`#${CSS.escape(id)}`);
  expect(description.length, `#${id} exists in the document`).to.equal(1);
  return description.text();
}

describe('Retry on a failed offline transfer', () => {
  beforeEach(() => {
    // Every enumeration fails fast, so both jobs reach ERROR without waiting on a real transfer.
    // The study list itself queries /studies and is unaffected.
    cy.intercept({ url: /\/series(\?|$)/ }, { statusCode: 500, body: 'enumeration refused' }).as(
      'seriesQuery'
    );

    cy.visit('/');
    cy.window().its('ohif.app.servicesManager.services.downloadManagerService').should('exist');

    cy.get('[data-cy="study-row"]')
      .first()
      .invoke('attr', 'data-study-uid')
      .then(uid => {
        cy.window().then(win => {
          const service = downloadService(win);

          service.enqueueStudy({
            server: activeServer(win),
            StudyInstanceUID: uid,
            descriptor: { PatientName: 'Doe^Jane', StudyDescription: 'CT CHEST' },
          });
          service.enqueueStudy({
            server: OTHER_SERVER,
            StudyInstanceUID: `${uid}.9`,
            descriptor: { PatientName: 'Roe^John', StudyDescription: 'MR BRAIN' },
          });
        });
      });

    cy.get('[data-cy="offline-storage-launcher"]').click();
    // Both rows are failed before anything is asserted about their controls.
    cy.get(RETRY).should('have.length', 2);
    cy.get(`${RETRY}[aria-disabled="true"]`).should('have.length', 1);
    cy.get(`${RETRY}[aria-disabled="false"]`).should('have.length', 1);

    // Retry itself is stubbed: these cases are about the control and the keyboard, and a real
    // re-run would depend on the network. Whether `retry()` re-arms correctly is covered by
    // DownloadManagerService.test.js.
    cy.window().then(win => {
      cy.stub(downloadService(win), 'retry').as('retry');
    });
  });

  it('reaches the Retry control of a job on another server by pressing Tab', () => {
    // Start from the row's own trigger and walk forward with real Tab presses. An element the
    // browser excludes from the focus order is never reached, however many times Tab is pressed.
    rowFor('true').find('[data-cy="offline-transfer-row"]').focus().should('be.focused');

    cy.realTabTo(`${RETRY}[aria-disabled="true"]`)
      .should('be.focused')
      .then($control => {
        expect(accessibleDescription($control), 'the description explains the server mismatch').to
          .contain('different imaging server');
      });
  });

  ['Enter', 'Space'].forEach(key => {
    it(`refuses ${key} on a job that belongs to another server`, () => {
      rowFor('true').find('[data-cy="offline-transfer-row"]').focus();
      cy.realTabTo(`${RETRY}[aria-disabled="true"]`).should('be.focused');

      cy.realKey(key);

      cy.get('@retry').should('not.have.been.called');
      // And the row is still a failed row, not a re-armed one.
      cy.get(`${RETRY}[aria-disabled="true"]`).should('exist');
    });

    it(`reaches and activates the Retry control of a job on the active server with ${key}`, () => {
      // The mirror of the case above, per key. Without it a control that is inert for everybody --
      // or a key this helper never really presses -- would satisfy the negative assertion.
      rowFor('false').find('[data-cy="offline-transfer-row"]').focus().should('be.focused');

      cy.realTabTo(`${RETRY}[aria-disabled="false"]`)
        .should('be.focused')
        .then($control => {
          expect(accessibleDescription($control), 'the description explains what Retry does').to
            .contain('missing from this device');
        });

      cy.realKey(key);
      cy.get('@retry').should('have.been.calledOnce');
    });
  });
});
