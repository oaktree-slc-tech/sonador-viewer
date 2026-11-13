// Settings > General: two tabs under one header and one footer.
// APPLICATION holds what belongs to the application as a whole: the language (hidden until the
// interface is translated: LANGUAGE_SELECTION_ENABLED) and the offline-storage transfer settings.
// SEGMENTATION EDITOR holds the editor's own preferences: how it opens, follows a selection, and
// what its 3D tools draw. The tabs are the dialog tabs the Viewer Metadata page uses
// (components/TabsNG); the tab bodies are presentational (ApplicationSettingsTab,
// SegEditorSettingsTab) and every field's state, hydration and save live here, so one Save posts
// the general section once for both tabs.
//
// Persistence is unchanged: the language, the offline-transfer settings and the locked-models
// warning are the server-side `general` section; the three segEditor* keys are
// UserPreferencesService's local-only keys (kept in this browser, never posted). A section POST
// replaces the section wholesale, so Save lays this page's own fields over a base holding the
// user's settings for the rest (lib/generalPreferences), and posts nothing if none can be read.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DownloadManagerService,
  DownloadManagerServiceEvents,
  LOCKED_MODELS_WARNING_PREFERENCE_KEY,
  RETRY_ATTEMPTS_DEFAULT,
  RETRY_ATTEMPTS_MAX,
  RETRY_ATTEMPTS_MIN,
  SEG_EDITOR_FOLLOW_SELECTION_DEFAULT,
  SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY,
  SEG_EDITOR_MESH_COLOR_AUTO,
  SEG_EDITOR_MESH_COLOR_DEFAULT,
  SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY,
  SEG_EDITOR_PREVIEW_COLOR_DEFAULT,
  SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY,
  UserPreferencesService,
  UserPreferencesServiceEvents,
} from '@ohif/core';

import TabsNG from '../../../../components/TabsNG/TabsNG';
import { showSaveOutcome } from '../../../../components/UserPreferences/saveOutcomeNotification';
import {
  ARCHIVE_TRANSFER_DEFAULT,
  ARCHIVE_TRANSFER_PREFERENCE_KEY,
  PREFERENCE_SECTIONS,
  RETRY_ATTEMPTS_PREFERENCE_KEY,
} from '../../../../constants/preferences';
import { saveGeneralSettings } from '../../../../lib/generalPreferences';
import { createHydrationLatch } from '../../../../lib/preferenceHydration';
import { useUpdateUserPreferenceSection } from '../../../../queries/preferences';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import ApplicationSettingsTab from './ApplicationSettingsTab';
import SegEditorSettingsTab, { MESH_SWATCH_FALLBACK } from './SegEditorSettingsTab';

import styles from './GeneralTabNG.module.scss';

export const TAB_APPLICATION = 'application';
export const TAB_SEG_EDITOR = 'seg-editor';

// Latch keys for the fields on this page: the two offline-storage fields by name, the service's
// keys by their preference key.
const ARCHIVE_FIELD = 'archiveTransfer';
const RETRY_FIELD = 'retryAttempts';
const LOCKED = LOCKED_MODELS_WARNING_PREFERENCE_KEY;
const FOLLOW = SEG_EDITOR_FOLLOW_SELECTION_PREFERENCE_KEY;
const PREVIEW = SEG_EDITOR_PREVIEW_COLOR_PREFERENCE_KEY;
const MESH = SEG_EDITOR_MESH_COLOR_PREFERENCE_KEY;
const SERVICE_FIELDS = [LOCKED, FOLLOW, PREVIEW, MESH];
const ALL_FIELDS = [ARCHIVE_FIELD, RETRY_FIELD, ...SERVICE_FIELDS];

const FALLBACK_DEFAULTS = {
  [LOCKED]: true,
  [FOLLOW]: SEG_EDITOR_FOLLOW_SELECTION_DEFAULT,
  [PREVIEW]: SEG_EDITOR_PREVIEW_COLOR_DEFAULT,
  [MESH]: SEG_EDITOR_MESH_COLOR_DEFAULT,
};

const defaultOf = key => UserPreferencesService?.GENERAL_DEFAULTS?.[key] ?? FALLBACK_DEFAULTS[key];
const stored = key => UserPreferencesService?.getGeneral?.(key) ?? defaultOf(key);

export default function GeneralTabNG() {
  // The preferences namespace, which is where every string on this surface is registered. Without
  // it i18next looks in the default namespace, finds nothing, and renders the key itself.
  const { t } = useTranslation('UserPreferencesModal');
  const { isDesktop } = useDeviceStore();

  const [tab, setTab] = useState(TAB_APPLICATION);

  // Which fields the user has changed. Per FIELD, not per form: the section is saved wholesale, so
  // one shared flag would let an edit to one control block hydration of the others and then post
  // their defaults over the values already stored. Never cleared by saving -- the startup GET
  // that was already in flight can still land afterwards (lib/preferenceHydration).
  const latch = useRef(createHydrationLatch()).current;
  // The fields changed since the last Save, for the save message
  const changed = useRef(new Set()).current;

  // The latest authoritative value of each field: what the page opened with, what hydration
  // delivered since (whether or not the field was being edited: the latch protects the draft, not
  // this), or what was last saved. Cancel puts it back, and the fields are compared against it to
  // know whether changes are pending (the settings console's pattern: Save and Cancel appear with the
  // first change).
  const [baseline, setBaseline] = useState({});
  const rebase = (field, value) => setBaseline(current => ({ ...current, [field]: value }));

  const edit = (field, apply) => value => {
    latch.markEdited(field);
    changed.add(field);
    apply(value);
  };

  // Offline-storage transfer strategy (ohif-viewers#129, FR-1). This page is the General
  // preferences surface the application actually renders: the account menu and the sidebar both
  // route to /settings, and the legacy UserPreferences modal is not on that path. Hydrated state
  // lives on DownloadManagerService, which is where a starting job reads it.
  const [archiveTransfer, setArchiveTransfer] = useState(
    () => DownloadManagerService?.isArchiveTransferEnabled?.() ?? ARCHIVE_TRANSFER_DEFAULT
  );
  useEffect(() => { rebase(ARCHIVE_FIELD, archiveTransfer); }, []);
  // Per-instance attempt budget (ohif-viewers#131, FR-12). Held as a number -- Numeric keeps it
  // inside min/max and ignores a partially typed value, so the form never holds something unusable.
  const [retryAttempts, setRetryAttempts] = useState(
    () => DownloadManagerService?.getRetryAttempts?.() ?? RETRY_ATTEMPTS_DEFAULT
  );
  useEffect(() => { rebase(RETRY_FIELD, retryAttempts); }, []);

  // The initial reads above can be too early. Preference hydration is an authenticated fetch kicked
  // off from a sibling effect, so opening /settings directly can render this form BEFORE the
  // stored values arrive: a control would show its default, and saving would write that default
  // over what the user had stored. Following the services' own events keeps the form honest.
  useEffect(() => {
    if (!DownloadManagerService?.subscribe) {
      return undefined;
    }
    const transfer = DownloadManagerService.subscribe(
      DownloadManagerServiceEvents.TRANSFER_MODE_CHANGED,
      ({ archiveTransferEnabled }) => {
        setArchiveTransfer(current => latch.accept(ARCHIVE_FIELD, archiveTransferEnabled, current));
        rebase(ARCHIVE_FIELD, archiveTransferEnabled);
      }
    );
    const retry = DownloadManagerService.subscribe(
      DownloadManagerServiceEvents.RETRY_ATTEMPTS_CHANGED,
      ({ retryAttempts: hydrated }) => {
        setRetryAttempts(current => latch.accept(RETRY_FIELD, hydrated, current));
        rebase(RETRY_FIELD, hydrated);
      }
    );
    return () => {
      transfer.unsubscribe();
      retry.unsubscribe();
    };
  }, []);

  const handleArchiveTransferChange = edit(ARCHIVE_FIELD, setArchiveTransfer);
  const handleRetryAttemptsChange = edit(RETRY_FIELD, setRetryAttempts);
  const stepRetryAttempts = useCallback(
    delta => {
      latch.markEdited(RETRY_FIELD);
      changed.add(RETRY_FIELD);
      setRetryAttempts(current => Math.min(RETRY_ATTEMPTS_MAX, Math.max(RETRY_ATTEMPTS_MIN, current + delta)));
    },
    [latch, changed]
  );

  // The Segmentation Editor's preferences, read from UserPreferencesService (hydrated or already
  // chosen this session): Open as Segmentation's warning about locked models (ohif-viewers!92;
  // the dialog's "Don't ask again" clears it, here is where it is turned back on), whether the
  // views follow the selected segment, the colour a pending 3D edit is drawn in, and the colour of
  // the edited segment's mesh ('auto' follows the segment). Each is also set from inside the
  // editor, and the subscription below keeps the field honest until the user touches it.
  const [lockedModelsWarning, setLockedModelsWarning] = useState(() => stored(LOCKED));
  const [followSelection, setFollowSelection] = useState(() => stored(FOLLOW));
  const [previewColor, setPreviewColor] = useState(() => stored(PREVIEW));
  const [meshColor, setMeshColor] = useState(() => stored(MESH));
  useEffect(() => {
    setBaseline(current => ({
      ...current, [LOCKED]: lockedModelsWarning, [FOLLOW]: followSelection, [PREVIEW]: previewColor, [MESH]: meshColor,
    }));
  }, []);
  const meshColorAuto = meshColor === SEG_EDITOR_MESH_COLOR_AUTO;
  // The colour last picked or landed, so turning "follows the segment" off brings it back
  const lastMeshPick = useRef(meshColorAuto ? MESH_SWATCH_FALLBACK : meshColor);

  useEffect(() => {
    if (!meshColorAuto) {
      lastMeshPick.current = meshColor;
    }
  }, [meshColor, meshColorAuto]);

  useEffect(() => {
    if (!UserPreferencesService?.subscribe) {
      return undefined;
    }
    const setters = {
      [LOCKED]: setLockedModelsWarning,
      [FOLLOW]: setFollowSelection,
      [PREVIEW]: setPreviewColor,
      [MESH]: setMeshColor,
    };
    const land = (key, value) => {
      setters[key](current => latch.accept(key, value, current));
      rebase(key, value);
    };
    // A value that landed between the first read and this subscription
    Object.keys(setters).forEach(key => land(key, stored(key)));
    const { unsubscribe } = UserPreferencesService.subscribe(
      UserPreferencesServiceEvents.GENERAL_CHANGED,
      ({ key, value }) => {
        if (setters[key]) {
          land(key, value);
        }
      }
    );
    return unsubscribe;
  }, []);

  const handleLockedModelsWarningChange = edit(LOCKED, setLockedModelsWarning);
  const handleFollowSelectionChange = edit(FOLLOW, setFollowSelection);
  const handlePreviewColorChange = edit(PREVIEW, setPreviewColor);
  const handleMeshColorPick = edit(MESH, setMeshColor);
  const handleMeshColorAutoChange = edit(MESH, auto => setMeshColor(auto ? SEG_EDITOR_MESH_COLOR_AUTO : lastMeshPick.current));

  const { mutateAsync: saveGeneralSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.GENERAL);

  const values = {
    [ARCHIVE_FIELD]: archiveTransfer,
    [RETRY_FIELD]: retryAttempts,
    [LOCKED]: lockedModelsWarning,
    [FOLLOW]: followSelection,
    [PREVIEW]: previewColor.toLowerCase(),
    [MESH]: meshColor.toLowerCase(),
  };
  // A save that did not reach the account leaves Save in the footer, so it can be made again
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false);
  const changesPending =
    saveUnconfirmed || ALL_FIELDS.some(field => field in baseline && values[field] !== baseline[field]);

  // Back to the latest authoritative values, on both tabs (a value hydration delivered while a
  // field was being edited included); the fields are open to hydration again
  const onCancel = () => {
    setArchiveTransfer(baseline[ARCHIVE_FIELD]);
    setRetryAttempts(baseline[RETRY_FIELD]);
    setLockedModelsWarning(baseline[LOCKED]);
    setFollowSelection(baseline[FOLLOW]);
    setPreviewColor(baseline[PREVIEW]);
    setMeshColor(baseline[MESH]);
    latch.reset();
    changed.clear();
    setSaveUnconfirmed(false);
  };

  const onSave = () => {
    const preview = previewColor.toLowerCase();
    const mesh = meshColor.toLowerCase();

    // Apply locally first, then sync through the write queue. The services record these as
    // explicit choices, so hydration in flight can no longer override them; an open editor follows
    // UserPreferencesService's event at once. The section POST below carries the locked-models
    // value, so the service must not post it a second time (persist: false); the three segEditor*
    // keys are local-only and the service keeps them in this browser.
    DownloadManagerService?.setArchiveTransferEnabled?.(archiveTransfer);
    DownloadManagerService?.setRetryAttempts?.(retryAttempts);
    UserPreferencesService?.setGeneral?.(LOCKED, lockedModelsWarning, { persist: false });
    UserPreferencesService?.setGeneral?.(FOLLOW, !!followSelection, { persist: false });
    UserPreferencesService?.setGeneral?.(PREVIEW, preview, { persist: false });
    UserPreferencesService?.setGeneral?.(MESH, mesh, { persist: false });

    // The confirmation names what changed and what it now does, not that something was saved
    const detail = [
      changed.has(ARCHIVE_FIELD) && t(archiveTransfer ? 'OfflineArchiveTransferSavedOn' : 'OfflineArchiveTransferSavedOff'),
      changed.has(RETRY_FIELD) && t('OfflineRetryAttemptsSaved', { count: retryAttempts }),
      changed.has(LOCKED) && t(lockedModelsWarning ? 'LockedModelsWarningSavedOn' : 'LockedModelsWarningSavedOff'),
      changed.has(FOLLOW) && t(followSelection ? 'SegEditorFollowSelectionSavedOn' : 'SegEditorFollowSelectionSavedOff'),
      changed.has(PREVIEW) && t('SegEditorPreviewColorSaved', { color: preview }),
      changed.has(MESH) && (mesh === SEG_EDITOR_MESH_COLOR_AUTO
        ? t('SegEditorMeshColorSavedAuto')
        : t('SegEditorMeshColorSavedFixed', { color: mesh })),
    ].filter(Boolean).join(' ');
    // What is applied is now what Cancel would put back
    setBaseline({ ...values });

    // A section POST replaces the section wholesale, so this page's own fields are laid over a base
    // that holds the user's settings for the keys the page does not show -- the language while its
    // selector is hidden among them: a write still queued, the hydrated holders, or the stored
    // section read now. The local-only keys are left out by the service. If no base can be read,
    // nothing is posted: the values stay applied here, and the message says the save did not
    // reach the account. Saves run one after another (saveGeneralSettings), so a second Save
    // reads its base only once the first has been submitted, and the newest choice lands last.
    // The changes are forgotten only once the save has gone through: a rejected save keeps them,
    // so the retry's message still names them. With nothing named (the language is not tracked
    // here), the message says the settings are saved as shown.
    const outcome = showSaveOutcome(t('GeneralSettingsSaved'), 'general preferences', detail || t('GeneralSettingsSavedDetail'));
    saveGeneralSettings(
      {
        [ARCHIVE_TRANSFER_PREFERENCE_KEY]: archiveTransfer,
        [RETRY_ATTEMPTS_PREFERENCE_KEY]: retryAttempts,
        [LOCKED]: lockedModelsWarning,
      },
      payload =>
        saveGeneralSection(payload).then(
          result => {
            changed.clear();
            setSaveUnconfirmed(result?.outcome === 'failed');
            outcome.onSuccess(result);
          },
          error => {
            setSaveUnconfirmed(true);
            outcome.onError(error);
          }
        )
    ).catch(error => {
      setSaveUnconfirmed(true);
      outcome.onUnavailable(error);
    });
  };

  // Every field on both tabs; nothing is saved until Save
  const onReset = () => {
    ALL_FIELDS.forEach(field => {
      latch.markEdited(field);
      changed.add(field);
    });
    setArchiveTransfer(ARCHIVE_TRANSFER_DEFAULT);
    setRetryAttempts(RETRY_ATTEMPTS_DEFAULT);
    setLockedModelsWarning(defaultOf(LOCKED));
    setFollowSelection(defaultOf(FOLLOW));
    setPreviewColor(defaultOf(PREVIEW));
    setMeshColor(defaultOf(MESH));
  };

  return (
    <>
      {isDesktop && <TabHeaderNG title="General Settings" description={t('GeneralSettingsDescription')} />}
      <TabsNG value={tab} onValueChange={setTab} className={styles.tabs}>
        <TabsNG.List className={styles.tabList}>
          <TabsNG.Trigger value={TAB_APPLICATION} data-cy="general-settings-application">
            {t('GeneralTabApplication')}
          </TabsNG.Trigger>
          <TabsNG.Trigger value={TAB_SEG_EDITOR} data-cy="general-settings-seg-editor">
            {t('GeneralTabSegEditor')}
          </TabsNG.Trigger>
        </TabsNG.List>
        <TabsNG.Content value={TAB_APPLICATION} className={styles.settings}>
          <ApplicationSettingsTab
            archiveTransfer={archiveTransfer}
            onArchiveTransferChange={handleArchiveTransferChange}
            retryAttempts={retryAttempts}
            onRetryAttemptsChange={handleRetryAttemptsChange}
            onStepRetryAttempts={stepRetryAttempts}
          />
        </TabsNG.Content>
        <TabsNG.Content value={TAB_SEG_EDITOR} className={styles.settings}>
          <SegEditorSettingsTab
            lockedModelsWarning={lockedModelsWarning}
            onLockedModelsWarningChange={handleLockedModelsWarningChange}
            followSelection={followSelection}
            onFollowSelectionChange={handleFollowSelectionChange}
            previewColor={previewColor}
            onPreviewColorChange={handlePreviewColorChange}
            meshColorAuto={meshColorAuto}
            onMeshColorAutoChange={handleMeshColorAutoChange}
            meshColor={meshColorAuto ? lastMeshPick.current : meshColor}
            onMeshColorPick={handleMeshColorPick}
          />
        </TabsNG.Content>
      </TabsNG>

      {/* One footer for both tabs: Reset Defaults resets both, and Save and Cancel appear while
          changes are pending. Save posts the section once; Cancel puts the saved values back */}
      <TabFooterNG
        onReset={onReset}
        onSave={onSave}
        onCancel={onCancel}
        changesPending={changesPending}
        hasErrors={false}
        resetHint={t('ResetDefaultsHint')}
        saveHint={t('SaveHint')}
        cancelHint={t('CancelChangesHint')}
      />
    </>
  );
}
