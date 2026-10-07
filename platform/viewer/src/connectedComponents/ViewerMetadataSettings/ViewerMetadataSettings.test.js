// The editor's visibility rule is pure; the component itself needs the viewer runtime.

jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('@ohif/core', () => ({ redux: { selectors: {} }, uiNotificationService: { show: jest.fn() } }));
jest.mock('@ohif/core/src/utils/overlayFields/mergeOptions', () => ({ mergeOverlayFieldOptions: jest.fn() }));
jest.mock('@ohif/ui/src/components/ModalNG/ModalNG', () => () => null);
jest.mock('../../components/TabsNG/TabsNG', () => () => null);
jest.mock('../../hooks/useDisplayAttributes', () => ({ useDisplayAttributeGroups: jest.fn(), useDisplayAttributes: jest.fn() }));
jest.mock('../../hooks/useTags', () => jest.fn());
jest.mock('./DisplayAttributesTab', () => () => null);
jest.mock('./ViewportDisplayTab', () => () => null);

import { offersDisplayAttributes } from './ViewerMetadataSettings';

const groups = [{ id: 1, name: 'alpha' }];

describe('offersDisplayAttributes', () => {
  it('requires the manage flag, staff, or superuser', () => {
    expect(offersDisplayAttributes({ display_attr_modify: true }, groups)).toBe(true);
    expect(offersDisplayAttributes({ is_staff: true }, groups)).toBe(true);
    expect(offersDisplayAttributes({ is_superuser: true }, groups)).toBe(true);
    expect(offersDisplayAttributes({ display_attr: true }, groups)).toBe(false);
    expect(offersDisplayAttributes({}, groups)).toBe(false);
    expect(offersDisplayAttributes(undefined, groups)).toBe(false);
  });

  it('requires at least one group with display attributes enabled', () => {
    expect(offersDisplayAttributes({ display_attr_modify: true }, [])).toBe(false);
    expect(offersDisplayAttributes({ display_attr_modify: true }, undefined)).toBe(false);
    expect(offersDisplayAttributes({ is_superuser: true }, [])).toBe(false);
  });
});
