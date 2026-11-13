// Settings > Hotkeys: two tabs under one header and one footer, in the dialog tabs Settings >
// General uses (components/TabsNG).
// APPLICATION holds the viewer's hotkeys: the HotkeysManager's bindings, defaulted by the app
// config. SEGMENTATION EDITOR holds the editor's own keys, which apply only while the editor is
// open (UserPreferencesService holds them; the editor reads them at each keypress).
//
// One Save applies both sets and posts the `hotkeys` preference section once: the section is
// replaced wholesale and carries both (lib/hotkeyPreferences.js). The stored bindings can land
// after the page opens (startup hydration is a fetch), so the page follows the bindings in effect
// for every binding the user has not changed, and a save lays only the changed bindings over the
// user's own: the bindings in effect once hydration has landed, the stored section otherwise.
// The result is validated before anything is applied, and a change stays the page's to write
// until the account has it.
//
// Two bindings may not share a combination, within a set or across the two, since both are live
// while the editor is open; combinations are compared the way their handler matches them
// (logic.js).

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  canonicalKeyCombination,
  SEG_EDITOR_HOTKEY_DEFAULTS,
  uiNotificationService,
  UserPreferencesService,
  UserPreferencesServiceEvents,
} from '@ohif/core';

import { hotkeysManager } from '../../../../App';
import TabsNG from '../../../../components/TabsNG/TabsNG';
import { showSaveOutcome } from '../../../../components/UserPreferences/saveOutcomeNotification';
import { PREFERENCE_SECTIONS, PREFERENCES_VERSION } from '../../../../constants/preferences';
import { subscribeHotkeysApplied } from '../../../../lib/hotkeyHydration';
import { composeHotkeyValues, resolveStoredHotkeys, saveHotkeysInOrder } from '../../../../lib/hotkeyPreferences';
import { useUpdateUserPreferenceSection } from '../../../../queries/preferences';
import { useDeviceStore } from '../../../../store/useDeviceStore';
import TabFooterNG from '../TabFooterNG/TabFooterNG';
import TabHeaderNG from '../TabHeaderNG/TabHeaderNG';

import HotkeyListNG from './HotkeyListNG';
import { sameKeys, validateCommandKey } from './logic';

import styles from './HotkeysTabNG.module.scss';

export const TAB_APPLICATION = 'application';
export const TAB_SEG_EDITOR = 'seg-editor';

// The two sets of bindings, by the key their draft is held under
const APPLICATION = 'application';
const SEG_EDITOR = 'segEditor';
const SETS = [APPLICATION, SEG_EDITOR];
const OTHER_SET = { [APPLICATION]: SEG_EDITOR, [SEG_EDITOR]: APPLICATION };

// How each set's handler matches a combination: the editor counts Cmd as Ctrl, and takes its own
// default combinations (Ctrl+Z among them) from the browser, so they are its to assign
const CTRL_MATCHES_META = { [APPLICATION]: false, [SEG_EDITOR]: true };
const SUPPORTED_COMBINATIONS = {
  [APPLICATION]: [],
  [SEG_EDITOR]: Object.values(SEG_EDITOR_HOTKEY_DEFAULTS).map(({ keys }) =>
    canonicalKeyCombination(keys, { ctrlMatchesMeta: true })
  ),
};

const isKeyCombination = (keys) => Array.isArray(keys) && keys.length > 0;

const copyOf = (hotkeys) =>
  Object.fromEntries(Object.entries(hotkeys || {}).map(([name, definition]) => [name, { ...definition }]));

const noNames = () => ({ [APPLICATION]: new Set(), [SEG_EDITOR]: new Set() });
const noKeys = () => ({ [APPLICATION]: {}, [SEG_EDITOR]: {} });

// The bindings in effect, which is what the page shows for a binding the user has not changed
// and what Cancel puts back
const currentHotkeys = () => ({
  [APPLICATION]: copyOf(hotkeysManager.hotkeyDefinitions),
  [SEG_EDITOR]: copyOf(UserPreferencesService?.getSegEditorHotkeys?.()),
});

const defaultHotkeys = () => ({
  [APPLICATION]: Object.fromEntries(
    hotkeysManager.hotkeyDefaults.map(({ commandName, ...definition }) => [commandName, { ...definition }])
  ),
  [SEG_EDITOR]: copyOf(SEG_EDITOR_HOTKEY_DEFAULTS),
});

// The stored section's bindings over the defaults, as startup hydration applies them
const storedHotkeys = (stored) => {
  const defaults = defaultHotkeys();
  const lay = (base, entries, known) => {
    const laid = copyOf(base);
    Object.entries(entries || {}).forEach(([name, entry]) => {
      if (isKeyCombination(entry?.keys) && (!known || laid[name])) {
        laid[name] = { label: entry.label, ...laid[name], keys: [...entry.keys] };
      }
    });
    return laid;
  };
  return {
    [APPLICATION]: lay(defaults[APPLICATION], stored.application, false),
    [SEG_EDITOR]: lay(defaults[SEG_EDITOR], stored.segEditor, true),
  };
};

// `base` with the keys of `drafts` for the bindings named in `names`
const withDrafts = (base, drafts, names) =>
  Object.fromEntries(
    SETS.map((set) => [
      set,
      Object.fromEntries(
        Object.entries(base[set]).map(([name, definition]) => [
          name,
          names[set].has(name) && drafts[set][name] ? { ...definition, keys: drafts[set][name].keys } : definition,
        ])
      ),
    ])
  );

export default function HotkeysTabNG() {
  const { t } = useTranslation('UserPreferencesModal');
  const { isDesktop } = useDeviceStore();

  const [tab, setTab] = useState(TAB_APPLICATION);
  const [baseline, setBaseline] = useState(currentHotkeys);
  const [hotkeys, setHotkeys] = useState(baseline);
  // The latest drafts, for a save that resolves after further edits
  const drafts = useRef(hotkeys);
  drafts.current = hotkeys;
  // The bindings the user has changed since the page was last clean, which the bindings in effect
  // must not replace (Reset Defaults changes them all), and, of those, the ones whose keys were
  // recorded in a field, which are the ones validated
  const edited = useRef(noNames());
  const recorded = useRef(noNames());
  // The keys of a save that are in effect here but did not reach the account, by binding: the
  // next save writes them again, and Save stays in the footer for it
  const unconfirmed = useRef(noKeys());
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const { mutateAsync: saveHotkeysSection } = useUpdateUserPreferenceSection(PREFERENCE_SECTIONS.HOTKEYS);

  // The bindings in effect changed under the page (startup hydration landing, or the editor's
  // bindings set elsewhere): they are the new saved values, and what every unchanged field shows
  useEffect(() => {
    const follow = () => {
      const inEffect = currentHotkeys();
      setBaseline(inEffect);
      setHotkeys((current) => withDrafts(inEffect, current, edited.current));
    };
    // A change that landed between the first read and these subscriptions
    follow();
    const unsubscribeApplied = subscribeHotkeysApplied(follow);
    const subscription = UserPreferencesService?.subscribe?.(
      UserPreferencesServiceEvents.SEG_EDITOR_HOTKEYS_CHANGED,
      follow
    );
    return () => {
      unsubscribeApplied();
      subscription?.unsubscribe?.();
    };
  }, []);

  const setNames = { [APPLICATION]: t('GeneralTabApplication'), [SEG_EDITOR]: t('GeneralTabSegEditor') };

  // Error message by binding, per set, for the bindings in `names`, each validated against
  // `bindings` as they stand
  const validate = (bindings, names) =>
    Object.fromEntries(
      SETS.map((set) => [
        set,
        Object.fromEntries(
          [...names[set]]
            .filter((name) => bindings[set][name])
            .map((name) => [
              name,
              validateCommandKey({
                commandName: name,
                pressedKeys: bindings[set][name].keys,
                hotkeys: bindings[set],
                otherHotkeys: bindings[OTHER_SET[set]],
                otherSetName: setNames[OTHER_SET[set]],
                ctrlMatchesMeta: CTRL_MATCHES_META[set],
                supportedCombinations: SUPPORTED_COMBINATIONS[set],
              }).errorMessage,
            ])
        ),
      ])
    );
  const anyError = (found) => SETS.some((set) => Object.values(found[set]).some(Boolean));

  // Every recorded binding against the drafts on the page, so an error raised by a conflict
  // clears when the other binding moves off the combination
  const errors = validate(hotkeys, recorded.current);

  const onHotkeyChanged = (set) => (name, keys) => {
    edited.current[set].add(name);
    recorded.current[set].add(name);
    setHotkeys({ ...hotkeys, [set]: { ...hotkeys[set], [name]: { ...hotkeys[set][name], keys } } });
  };

  // Both tabs; nothing is saved until Save
  const onReset = () => {
    const defaults = defaultHotkeys();
    edited.current = Object.fromEntries(SETS.map((set) => [set, new Set(Object.keys(defaults[set]))]));
    recorded.current = noNames();
    setHotkeys(defaults);
  };

  // The saved keys again. A save that did not reach the account is given up with them: its
  // bindings stay in effect here, as the save's message said
  const onCancel = () => {
    edited.current = noNames();
    recorded.current = noNames();
    unconfirmed.current = noKeys();
    setHotkeys(baseline);
    setSaveUnconfirmed(false);
  };

  // Applied here, then synced through the write queue. The application's bindings are also
  // cached where they are read before authentication; the editor's are cached by their holder.
  const apply = (bindings) => {
    hotkeysManager.setHotkeys(bindings[APPLICATION]);
    try {
      localStorage.setItem('hotkey-definitions', JSON.stringify(bindings[APPLICATION]));
    } catch (error) {
      // The cache is best-effort
    }
    UserPreferencesService?.setSegEditorHotkeys?.(bindings[SEG_EDITOR]);
  };

  const onSave = () => {
    const saved = hotkeys;
    // The keys this save is to write: the bindings changed on the page, and those of an earlier
    // save that did not reach the account. Only these are the page's to write; the rest are
    // written as the user has them, which a page opened before hydration landed may never
    // have shown.
    const intended = Object.fromEntries(
      SETS.map((set) => [
        set,
        {
          ...unconfirmed.current[set],
          ...Object.fromEntries(
            [...edited.current[set]].filter((name) => saved[set][name]).map((name) => [name, saved[set][name].keys])
          ),
        },
      ])
    );
    const intendedNames = Object.fromEntries(SETS.map((set) => [set, new Set(Object.keys(intended[set]))]));
    const withIntended = (base) => withDrafts(base, Object.fromEntries(
      SETS.map((set) => [set, Object.fromEntries(Object.entries(intended[set]).map(([name, keys]) => [name, { keys }]))])
    ), intendedNames);

    // The bindings changed again on the page since Save was pressed, which stay unsaved drafts
    const changedSince = () =>
      Object.fromEntries(
        SETS.map((set) => [
          set,
          new Set(
            [...edited.current[set]].filter(
              (name) =>
                drafts.current[set][name] &&
                saved[set][name] &&
                !sameKeys({ [name]: drafts.current[set][name] }, { [name]: saved[set][name] })
            )
          ),
        ])
      );

    // `bindings` are in effect and are what the page shows as saved
    const applied = (bindings) => {
      const latest = drafts.current;
      edited.current = changedSince();
      recorded.current = Object.fromEntries(
        SETS.map((set) => [set, new Set([...recorded.current[set]].filter((name) => edited.current[set].has(name)))])
      );
      apply(bindings);
      setBaseline(bindings);
      setHotkeys(withDrafts(bindings, latest, edited.current));
    };

    // `bindings` cannot be saved: nothing is applied, and the page shows them as drafts, the
    // refused ones marked, so the conflict can be resolved and the save made again
    const refused = (bindings) => {
      const latest = drafts.current;
      const again = changedSince();
      const inEffect = currentHotkeys();
      edited.current = Object.fromEntries(
        SETS.map((set) => [
          set,
          new Set([
            ...again[set],
            ...intendedNames[set],
            ...Object.keys(bindings[set]).filter(
              (name) => !inEffect[set][name] || !sameKeys({ [name]: bindings[set][name] }, { [name]: inEffect[set][name] })
            ),
          ]),
        ])
      );
      recorded.current = Object.fromEntries(
        SETS.map((set) => [set, new Set([...recorded.current[set], ...intendedNames[set]])])
      );
      setHotkeys(withDrafts(bindings, latest, again));
    };

    setSaving(true);
    const outcome = showSaveOutcome(t('HotkeysSaved'), 'hotkeys');
    saveHotkeysInOrder(async () => {
      let base;
      let unavailable = null;
      try {
        const stored = await resolveStoredHotkeys();
        base = stored ? storedHotkeys(stored) : currentHotkeys();
      } catch (error) {
        // Nothing can be posted without replacing what is stored; the change applies here
        unavailable = error;
        base = currentHotkeys();
      }

      // What was valid on the page may not be over the base, which can have landed since
      const bindings = withIntended(base);
      if (anyError(validate(bindings, intendedNames))) {
        refused(bindings);
        throw Object.assign(new Error('The hotkeys to save conflict'), { hotkeyConflict: true });
      }

      // In effect from here, and kept as this page's to write until the account has them
      unconfirmed.current = intended;
      applied(bindings);
      if (unavailable) {
        throw Object.assign(unavailable, { storedHotkeysUnavailable: true });
      }
      return saveHotkeysSection({
        version: PREFERENCES_VERSION,
        values: composeHotkeyValues(bindings[APPLICATION], bindings[SEG_EDITOR]),
      });
    })
      .then(
        (result) => {
          const persisted = result?.outcome !== 'failed';
          if (persisted) {
            unconfirmed.current = noKeys();
          }
          setSaveUnconfirmed(!persisted);
          outcome.onSuccess(result);
        },
        (error) => {
          if (error?.hotkeyConflict) {
            uiNotificationService.show({
              title: t('HotkeysNotSaved'),
              message: t('HotkeysNotSavedConflict'),
              type: 'error',
            });
            return;
          }
          setSaveUnconfirmed(true);
          (error?.storedHotkeysUnavailable ? outcome.onUnavailable : outcome.onError)(error);
        }
      )
      .finally(() => setSaving(false));
  };

  const hasErrors = anyError(errors);
  const changesPending = saveUnconfirmed || SETS.some((set) => !sameKeys(hotkeys[set], baseline[set]));

  return (
    <>
      {isDesktop && <TabHeaderNG title="Hotkey Settings" description={t('HotkeySettingsDescription')} />}
      <TabsNG value={tab} onValueChange={setTab} className={styles.tabs}>
        <TabsNG.List className={styles.tabList}>
          <TabsNG.Trigger value={TAB_APPLICATION} data-cy="hotkey-settings-application">
            {t('GeneralTabApplication')}
          </TabsNG.Trigger>
          <TabsNG.Trigger value={TAB_SEG_EDITOR} data-cy="hotkey-settings-seg-editor">
            {t('GeneralTabSegEditor')}
          </TabsNG.Trigger>
        </TabsNG.List>
        <TabsNG.Content value={TAB_APPLICATION}>
          <HotkeyListNG
            idPrefix="hotkey-application"
            hotkeys={hotkeys[APPLICATION]}
            errors={errors[APPLICATION]}
            onChange={onHotkeyChanged(APPLICATION)}
            emptyMessage={t('HotkeysApplicationEmpty')}
          />
        </TabsNG.Content>
        <TabsNG.Content value={TAB_SEG_EDITOR}>
          <p className={styles.help}>{t('HotkeysSegEditorHelp')}</p>
          <HotkeyListNG
            idPrefix="hotkey-seg-editor"
            hotkeys={hotkeys[SEG_EDITOR]}
            errors={errors[SEG_EDITOR]}
            onChange={onHotkeyChanged(SEG_EDITOR)}
          />
        </TabsNG.Content>
      </TabsNG>

      {/* One footer for both tabs: Reset Defaults resets both, and Save and Cancel appear while
          changes are pending. Save applies and posts both sets; Cancel puts the saved keys back */}
      <TabFooterNG
        onReset={onReset}
        onSave={onSave}
        onCancel={onCancel}
        changesPending={changesPending}
        hasErrors={hasErrors || saving}
        resetHint={t('HotkeysResetDefaultsHint')}
        saveHint={t('HotkeysSaveHint')}
        cancelHint={t('HotkeysCancelChangesHint')}
      />
    </>
  );
}
