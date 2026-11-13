// The whole-surface controls of the 3D Tools palette (see wholeSurface.js for the model): the
// "⋯" menu in the title row and the status block under the tool row, shown with every tool.
// Built from the @ohif/ui-next kit as it ships: its Button, DropdownMenu (items, checkbox items,
// label, separator, shortcut), Tooltip (through Tip, the kit's ToolButton idiom), HoverCard and
// Icons; no sizes or colours of the kit's are overridden here.

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { useSystem } from '@ohif/core';
import {
  Button, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, HoverCard, HoverCardContent, HoverCardPortal,
  HoverCardTrigger, Icons,
} from '@ohif/ui-next';

import { editSummary } from '../threeDTools/editSummary';
import { get3DToolState, request3DToolAction, set3DToolOption, subscribe3DToolState } from '../threeDTools/threeDToolState';
import { SEG_EDITOR_COMMAND_CONTEXT } from '../toolbox/constants';
import { MESH_COLOR_AUTO, setMeshColor, useMeshColor } from '../utils/meshColor';

import { StatusIcon, Tip } from './panelControls';
import { openRepairSurface, RepairSurfaceCard } from './RepairSurfaceCard';
import { surfaceStatus, syncStatus, wholeSurfaceMenu } from './wholeSurface';


const number = value => Number(value || 0).toLocaleString();

// A checkbox or radio item whose check sits centred on the 24px title line, not on the item
const CHECK_ON_TITLE = 'items-start [&>span]:top-1 [&>span]:h-6';

// Menus and hover cards are portalled into the editor panel's themed root, so they are styled
const portalContainer = () => (typeof document !== 'undefined' ? document.querySelector('[data-seg-editor-theme]') : null);

function use3DToolState() {
  const [state, setState] = useState(get3DToolState);
  useEffect(() => subscribe3DToolState(setState), []);
  return state;
}

/** A menu entry: the label, a muted status beside it (the kit's shortcut slot), and a detail line. */
function MenuEntry({ title, trailing, description }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {trailing && <DropdownMenuShortcut className="tracking-normal">{trailing}</DropdownMenuShortcut>}
      </div>
      {description && <div className="text-muted-foreground text-xs">{description}</div>}
    </div>
  );
}

MenuEntry.propTypes = { title: PropTypes.string.isRequired, trailing: PropTypes.string, description: PropTypes.string };

/** The "⋯" Model Actions menu before the 3D Tools title: Repair surface..., Synchronize 2D slices..., display. */
export function WholeSurfaceMenu() {
  const { t } = useTranslation('SegmentationEditor');
  const state = use3DToolState();
  const meshColor = useMeshColor();
  const menu = wholeSurfaceMenu(t, state, { meshColor });
  const customColor = useRef(null);

  return (
    <DropdownMenu>
      {/* The tip stays mounted while the menu is open: unmounting it would re-parent the trigger,
          which remounts it under the open menu (the menu loses its anchor, closes, the tip
          returns, and so on). The kit's tooltip closes itself on the pointer down that opens
          the menu. */}
      {/* The trigger as the kit's segmentation header and rows draw theirs */}
      <Tip text={t('Model Actions')} detail={t('Repair, synchronize and display options that act on the entire 3D surface, never on the selection.')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="seg-action ml-1" aria-label={t('Model Actions')} aria-haspopup="menu" data-cy="seg-editor-whole-surface-menu">
            <Icons.More />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent container={portalContainer()} align="start" className="w-64" data-cy="seg-editor-whole-surface-items">
        <DropdownMenuLabel>{t('Model Actions')}</DropdownMenuLabel>
        <DropdownMenuItem disabled={!menu.repair.enabled} onSelect={openRepairSurface} data-cy="seg-editor-menu-repair">
          <MenuEntry title={menu.repair.title} trailing={menu.repair.trailing} description={menu.repair.description} />
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!menu.synchronize.enabled} onSelect={() => request3DToolAction('synchronizeSurface')} data-cy="seg-editor-menu-synchronize">
          <MenuEntry title={menu.synchronize.title} trailing={menu.synchronize.trailing} description={menu.synchronize.description} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('Display')}</DropdownMenuLabel>
        {/* The check sits centred on the title line (a 24px line box under 4px of padding), not
            against the detail line: the indicator span spans the title line and centres in it */}
        <div className="flex items-stretch">
          <DropdownMenuCheckboxItem
            checked={menu.showMesh.checked}
            onCheckedChange={value => set3DToolOption('showMesh', value)}
            className={`${CHECK_ON_TITLE} flex-1 pr-1`}
            data-cy="seg-editor-menu-show-mesh"
          >
            <MenuEntry title={menu.showMesh.title} description={menu.showMesh.description} />
          </DropdownMenuCheckboxItem>
          {/* The mesh colour, to the right of Show mesh: the colour in effect as a swatch, opening
              a palette of the segment's own shades, Auto (follow the segment) and Custom... */}
          <DropdownMenuSub>
            {/* On the title line, as the check is (the item's py-1 plus the 24px line box) */}
            <DropdownMenuSubTrigger className="mt-1 h-6 self-start px-1 py-0" aria-label={t('Mesh colour')} data-cy="seg-editor-menu-mesh-color">
              <i className="border-input/60 inline-block h-4 w-4 rounded-full border" style={{ backgroundColor: menu.meshColor.effective }} aria-hidden="true" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={2} className="p-1" data-cy="seg-editor-mesh-color-palette">
              <DropdownMenuLabel className="pb-0">{t('Mesh colour')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={menu.meshColor.preference} onValueChange={value => setMeshColor(value)}>
                {/* The swatches are not spans: the kit's radio indicator is the item's span, hidden here */}
                <div className="grid grid-cols-6 gap-1.5 px-2 pb-1 pt-1">
                  {menu.meshColor.palette.map(hex => (
                    <DropdownMenuRadioItem
                      key={hex}
                      value={hex}
                      className="h-6 w-6 justify-center rounded-full p-0 pl-0 pr-0 [&>span]:hidden"
                      aria-label={hex}
                      data-cy={`seg-editor-mesh-color-${hex.slice(1)}`}
                    >
                      <i
                        className={`border-input/60 block h-5 w-5 rounded-full border ${menu.meshColor.preference === hex ? 'ring-primary ring-offset-background ring-2 ring-offset-1' : ''}`}
                        style={{ backgroundColor: hex }}
                      />
                    </DropdownMenuRadioItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuRadioItem value={MESH_COLOR_AUTO} className={CHECK_ON_TITLE} data-cy="seg-editor-mesh-color-auto">
                  <MenuEntry title={t('Auto')} description={t('A much lighter or darker shade of the segment\'s own colour.')} />
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuItem
                onSelect={event => { event.preventDefault(); customColor.current?.click(); }}
                className="pl-8"
                data-cy="seg-editor-mesh-color-custom"
              >
                {t('Custom...')}
                <input
                  ref={customColor}
                  type="color"
                  className="sr-only"
                  aria-label={t('Mesh colour')}
                  value={menu.meshColor.effective}
                  onChange={event => setMeshColor(event.target.value)}
                  data-cy="seg-editor-mesh-color-input"
                />
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </div>
        <DropdownMenuCheckboxItem checked={menu.showIssues.checked} onCheckedChange={value => set3DToolOption('showIssues', value)} className={CHECK_ON_TITLE} data-cy="seg-editor-menu-show-issues">
          <MenuEntry title={menu.showIssues.title} description={menu.showIssues.description} />
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The status block under the tool row, with every tool: the surface health (a hover card with
 * the counts; a click opens Repair surface), the 2D slices behind the surface with
 * Synchronize..., and the last edit with Undo. A repair preview starting brings the Repair
 * surface dialog up, where its Apply / Cancel live.
 */
export function WholeSurfaceStatus() {
  const { t } = useTranslation('SegmentationEditor');
  const { commandsManager } = useSystem();
  const state = use3DToolState();
  const status = surfaceStatus(t, state);
  const sync = syncStatus(t, state);
  const openRepair = openRepairSurface;
  const previewingRepair = !!state.preview?.repair;
  const { surfaceHealth: health } = state;
  const counts = health ? [
    ['Open edges', health.boundaryEdgeCount],
    ['Non-manifold edges', health.nonManifoldEdgeCount],
    ['Inverted edges', health.inconsistentEdgeCount],
    ['Degenerate triangles', health.degenerate],
    ['Duplicate triangles', health.duplicate],
  ].filter(([, count]) => count > 0) : [];

  // A repair preview brings the card up (its Apply / Cancel live there); closing is the user's
  useEffect(() => {
    if (previewingRepair) {
      openRepairSurface();
    }
  }, [previewingRepair]);

  const undo = () => commandsManager?.runCommand('undoSegEditor', {}, SEG_EDITOR_COMMAND_CONTEXT);

  return (
    <div className="text-foreground flex flex-col gap-1 py-1 text-sm" data-cy="seg-editor-surface-status">
      {status.interactive ? (
        <HoverCard openDelay={400}>
          <HoverCardTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 px-2 font-normal" onClick={openRepair} data-cy="seg-editor-surface-health">
              <StatusIcon tone={status.tone} />
              <span className={`min-w-0 flex-1 truncate text-left ${status.tone === 'muted' ? 'text-muted-foreground' : ''}`}>{status.text}</span>
              <Icons.ChevronRight className="text-muted-foreground h-4 w-4 flex-none" aria-hidden="true" />
            </Button>
          </HoverCardTrigger>
          <HoverCardPortal container={portalContainer()}>
            <HoverCardContent side="bottom" align="start" data-cy="seg-editor-surface-health-card">
              <div className="space-y-2">
                <div className="text-foreground text-sm">{t('Surface health')}</div>
                {counts.length > 0 && (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                    {counts.map(([label, count]) => (
                      <React.Fragment key={label}>
                        <dt>{t(label)}</dt>
                        <dd className="text-foreground m-0 tabular-nums">{number(count)}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
                {health?.triangles > 0 && <div className="text-xs">{t('{{count}} triangles', { count: number(health.triangles) })}</div>}
                <div className="text-xs">{t('Open Repair surface: edge counts, Show issues and Repair. Acts on the whole 3D surface.')}</div>
              </div>
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCard>
      ) : (
        <p className="text-muted-foreground m-0 flex items-center gap-2 px-2" data-cy="seg-editor-surface-health">
          <StatusIcon tone={status.tone} />
          <span>{status.text}</span>
        </p>
      )}
      {sync.pending && (
        <p className="text-muted-foreground m-0 px-2" role="status" data-cy="seg-editor-pending-writes">{sync.pending}</p>
      )}
      {sync.ahead && (
        // The synchronization state (ohif-viewers#152 §6): how many applied edits the 2D slices
        // have not received, how many of those are failed writes, and the way to resolve it
        // (Synchronize asks the same question the handoff does)
        <div className="flex flex-col gap-1 px-2" data-cy="seg-editor-unsynchronized">
          <p className="m-0 text-[#e8b04c]" role="status">{sync.ahead}</p>
          {sync.failed && <p className="m-0 text-[#ff7c7c]" role="status" data-cy="seg-editor-failed-writes">{sync.failed}</p>}
          <Tip text={t('Synchronize 2D slices...')} detail={t('Writes the surface\'s unwritten edits to the 2D slices. Opens a choice of how.')}>
            <span className="self-start">
              <Button variant="secondary" disabled={!sync.canSynchronize} onClick={() => request3DToolAction('synchronizeSurface')} data-cy="seg-editor-synchronize">
                {t('Synchronize...')}
              </Button>
            </span>
          </Tip>
        </div>
      )}
      {state.repairPanel && <RepairSurfaceCard />}
      {state.lastEdit && !state.preview && (
        <div className="text-muted-foreground flex items-center justify-between gap-2 px-2 text-xs" data-cy="seg-editor-last-edit">
          <span className="min-w-0 flex-1 leading-snug">{t('Last edit: {{summary}}', { summary: editSummary(t, state.lastEdit) })}</span>
          <Tip text={t('Undo')} detail={t('Undo the last edit')}>
            <Button variant="ghost" size="icon" className="flex-none" aria-label={t('Undo')} onClick={undo} data-cy="seg-editor-undo-last-edit">
              <Icons.Undo className="h-4 w-4" />
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}
