// Keyboard reachability of the offline-storage details card (ohif-viewers#129, #130).
//
// PREREQUISITES: the viewer served at `baseUrl`, a session that reaches the study list, and at
// least one study in the table. Run with `yarn test:e2e:sonador` from platform/viewer.
//
// The cache is seeded through the registered `localCacheService` rather than by running a transfer:
// `putInstance` is the write path a download uses, so the card renders from real index entries
// without the spec depending on the network.
//
// The card is a Popover rather than a HoverCard because it carries an interactive control, and
// hover-card content is not reachable by keyboard. That is the property under test, across all
// three triggers: an Offline Studies row, the study-table badge, and an active transfer row.
//
// SCOPE, STATED PRECISELY so these cases are not read as more than they are. What is exercised:
// the trigger takes focus, Enter opens the card, Radix moves focus into the content, Escape closes
// it and returns focus to the trigger, and the removal control is focusable and activates on Enter.
// What is NOT exercised: the browser's own Tab sequence. Cypress 13 has no native tab command, so
// the control is reached with `.focus()`, which distinguishes "focusable" from "actually next in
// the tab order" -- these cases prove the former. Where the tab order itself is the property under
// test, use the `cy.realTab` / `cy.realTabTo` commands in `support/commands.js`, which dispatch
// through the DevTools protocol; OfflineStorageRetryKeyboard.spec.js does exactly that.

const SEEDED_STUDY = '1.2.826.0.1.3680043.999.42';
const SEEDED_SERIES_ONE = `${SEEDED_STUDY}.1`;
const SEEDED_SERIES_TWO = `${SEEDED_STUDY}.2`;

function cacheService(win) {
  const service = win.ohif?.app?.servicesManager?.services?.localCacheService;
  if (!service) {
    throw new Error('localCacheService is not registered; the app has not finished booting.');
  }
  return service;
}

function downloadService(win) {
  return win.ohif?.app?.servicesManager?.services?.downloadManagerService;
}

/** Two cached series for `StudyInstanceUID`, written through the service the queue writes with. */
function seedSeries(win, StudyInstanceUID) {
  const service = cacheService(win);

  const put = (SeriesInstanceUID, SeriesNumber) =>
    service.putInstance({
      StudyInstanceUID,
      SeriesInstanceUID,
      SOPInstanceUID: `${SeriesInstanceUID}.1`,
      bytes: new ArrayBuffer(2048),
      metadata: {
        StudyInstanceUID,
        SeriesInstanceUID,
        SOPInstanceUID: `${SeriesInstanceUID}.1`,
        SeriesNumber,
        Modality: 'CT',
        SeriesDescription: `Axial ${SeriesNumber}mm`,
        PatientName: [{ Alphabetic: 'Doe^Jane' }],
        PatientID: 'MRN0042',
        StudyDescription: 'CT CHEST',
      },
    });

  return service
    .ready()
    .then(() => service.clearAll())
    .then(() => put(`${StudyInstanceUID}.1`, 1))
    .then(() => put(`${StudyInstanceUID}.2`, 2));
}

/**
 * The card is open AND focus is inside it.
 *
 * This is the reachability claim, and the one a hover card cannot satisfy: Radix moves focus into
 * popover content when it opens, so activating the trigger from the keyboard leaves the user inside
 * the card without a pointer ever being involved.
 */
function expectCardOpenAndFocused() {
  cy.get('[data-cy="offline-details-card"]').should('be.visible');
  cy.focused().then($focused => {
    const card = Cypress.$('[data-cy="offline-details-card"]')[0];
    expect(card === $focused[0] || card.contains($focused[0]), 'focus is inside the card').to.be
      .true;
  });
}

/**
 * Elements inside the card that carry a focusable role, by selector.
 *
 * A structural check, not a traversal: it confirms a control is not hidden, disabled, or held out
 * of the tab sequence with `tabindex="-1"`. It does not replay what the browser would do on Tab.
 */
function cardFocusables() {
  return cy
    .get('[data-cy="offline-details-card"]')
    .find('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    .filter(':visible');
}

describe('Offline storage details card', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.window().its('ohif.app.servicesManager.services.localCacheService').should('exist');
  });

  context('Offline Studies row', () => {
    beforeEach(() => {
      cy.window().then(win => seedSeries(win, SEEDED_STUDY));
      cy.get('[data-cy="offline-storage-launcher"]').click();
      cy.get('[data-cy="offline-studies-tab"]').click();
      cy.get('[data-cy="offline-study-row"]').should('have.length', 1);
    });

    it('opens from the keyboard, and Escape returns focus to the trigger', () => {
      cy.get('[data-cy="offline-study-row"]').first().as('trigger');

      cy.get('@trigger').focus().should('be.focused').type('{enter}');
      expectCardOpenAndFocused();

      cy.focused().type('{esc}');
      cy.get('[data-cy="offline-details-card"]').should('not.exist');
      // Radix restores focus through the trigger ref, which only PopoverTrigger populates.
      cy.get('@trigger').should('be.focused');
    });

    it('exposes the removal control as a focusable element and activates it with Enter', () => {
      cy.get('[data-cy="offline-study-row"]').first().focus().type('{enter}');
      expectCardOpenAndFocused();

      // Focusable within the card, not merely rendered: the control answers a focusable-selector
      // query of the card's own subtree, and focus is already inside the card. Whether the
      // browser's Tab sequence arrives here is not asserted -- see the scope note at the top.
      cardFocusables().then($focusables => {
        const removals = $focusables.filter('[data-cy="offline-series-remove"]');
        expect(removals.length, 'removal controls are focusable within the card').to.equal(2);
      });

      cy.get(`[data-cy="offline-series-remove"][data-series-uid="${SEEDED_SERIES_ONE}"]`)
        .focus()
        .should('be.focused')
        .type('{enter}');

      cy.get(`[data-cy="offline-series-remove"][data-series-uid="${SEEDED_SERIES_ONE}"]`).should(
        'not.exist'
      );
      cy.get(`[data-cy="offline-series-remove"][data-series-uid="${SEEDED_SERIES_TWO}"]`).should(
        'exist'
      );
      // The card stays open, so a second series can be removed without reopening it.
      cy.get('[data-cy="offline-details-card"]').should('be.visible');

      cy.window().then(win => {
        const service = cacheService(win);
        expect(service.isSeriesCachedSync(SEEDED_SERIES_ONE)).to.equal(false);
        expect(service.isSeriesCachedSync(SEEDED_SERIES_TWO)).to.equal(true);
      });
    });

    it('does not dismiss when the removal control is clicked', () => {
      cy.get('[data-cy="offline-study-row"]').first().click();
      cy.get('[data-cy="offline-details-card"]').should('be.visible');

      cy.get(`[data-cy="offline-series-remove"][data-series-uid="${SEEDED_SERIES_ONE}"]`).click();

      cy.get('[data-cy="offline-details-card"]').should('be.visible');
      cy.get(`[data-cy="offline-series-remove"][data-series-uid="${SEEDED_SERIES_TWO}"]`).should(
        'exist'
      );
    });
  });

  context('Study table offline badge', () => {
    beforeEach(() => {
      // Seed the study the table is actually showing, so the badge has a row to render on. The UID
      // is read off the row rather than assumed, keeping the spec independent of fixtures.
      cy.get('[data-cy="study-row"]').first().invoke('attr', 'data-study-uid').as('tableStudyUid');
      cy.get('@tableStudyUid').then(uid => {
        cy.window().then(win => seedSeries(win, uid));
      });
      cy.get('[data-cy="offline-indicator"]').should('exist');
    });

    it('opens the same card from the keyboard and returns focus on Escape', () => {
      cy.get('[data-cy="offline-indicator"]').first().as('badge');

      cy.get('@badge').focus().should('be.focused').type('{enter}');
      expectCardOpenAndFocused();
      cy.get('[data-cy="offline-series-remove"]').should('have.length', 2);

      cy.focused().type('{esc}');
      cy.get('[data-cy="offline-details-card"]').should('not.exist');
      cy.get('@badge').should('be.focused');
    });
  });

  context('Active transfer row', () => {
    beforeEach(() => {
      // Hold the study's metadata request open so the job stays in flight and its row persists.
      cy.intercept({ url: /\/series(\?|$)/ }, req => {
        req.on('response', res => res.setDelay(30000));
      }).as('seriesQuery');

      cy.get('[data-cy="study-row"]')
        .first()
        .invoke('attr', 'data-study-uid')
        .then(uid => {
          cy.window().then(win => {
            const service = downloadService(win);
            expect(service, 'downloadManagerService is registered').to.exist;
            service.enqueueStudy({
              server: win.store.getState().servers?.servers?.find(s => s.active),
              StudyInstanceUID: uid,
              descriptor: { PatientName: 'Doe^Jane', StudyDescription: 'CT CHEST' },
            });
          });
        });

      cy.get('[data-cy="offline-storage-launcher"]').click();
      cy.get('[data-cy="offline-transfer-row"]').should('exist');
    });

    it('opens its details card from the keyboard', () => {
      cy.get('[data-cy="offline-transfer-row"]').first().as('trigger');

      cy.get('@trigger').focus().should('be.focused').type('{enter}');
      expectCardOpenAndFocused();

      cy.focused().type('{esc}');
      cy.get('[data-cy="offline-details-card"]').should('not.exist');
      cy.get('@trigger').should('be.focused');
    });
  });
});
