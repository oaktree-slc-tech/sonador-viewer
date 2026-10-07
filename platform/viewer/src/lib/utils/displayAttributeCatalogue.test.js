import { catalogueRows, searchCatalogue } from './displayAttributeCatalogue';

const catalogue = {
  Study: {
    '0008,1030': { code: '0008,1030', tag: 'StudyDescription', label: 'Study Description', vr: { code: 'LO' } },
    '0008,0080': { code: '0008,0080', tag: 'InstitutionName', label: 'Institution Name' },
  },
  Series: {
    '0008,1030': { code: '0008,1030', tag: 'StudyDescription', label: 'Study Description' },
    '0018,1030': { code: '0018,1030', tag: 'ProtocolName', label: 'Protocol Name' },
  },
  Instance: {
    '0043,102d': { code: '0043,102d', tag: 'GEFilter', private: true },
    bogus: { tag: 'Nope' },
  },
};

describe('catalogueRows', () => {
  it('yields one sorted row per code with a display code and private flag', () => {
    const rows = catalogueRows(catalogue);

    expect(rows.map(row => row.code)).toEqual(['0043102D', '00080080', '00181030', '00081030']);
    expect(rows[0]).toEqual({ code: '0043102D', display: '0043,102D', keyword: 'GEFilter', label: 'GEFilter', private: true });
    expect(rows[3].private).toBe(false);
  });

  it('leaves out excluded codes', () => {
    const rows = catalogueRows(catalogue, new Set(['00081030', '00181030']));

    expect(rows.map(row => row.code)).toEqual(['0043102D', '00080080']);
  });

  it('handles an empty or missing catalogue', () => {
    expect(catalogueRows(undefined)).toEqual([]);
    expect(catalogueRows({ Study: null })).toEqual([]);
  });
});

describe('searchCatalogue', () => {
  const rows = catalogueRows(catalogue);

  it('returns the leading rows for an empty term, bounded by the limit', () => {
    expect(searchCatalogue(rows, '', 2)).toHaveLength(2);
    expect(searchCatalogue(rows, '   ')).toHaveLength(rows.length);
  });

  it('matches label, keyword and code, ignoring code punctuation and case', () => {
    expect(searchCatalogue(rows, 'protocol').map(row => row.code)).toEqual(['00181030']);
    expect(searchCatalogue(rows, 'institutionname').map(row => row.code)).toEqual(['00080080']);
    expect(searchCatalogue(rows, '(0043,102d)').map(row => row.code)).toEqual(['0043102D']);
    expect(searchCatalogue(rows, '0008').map(row => row.code)).toEqual(['00080080', '00081030']);
  });

  it('returns nothing for a term that matches nothing', () => {
    expect(searchCatalogue(rows, 'zzz')).toEqual([]);
  });
});
