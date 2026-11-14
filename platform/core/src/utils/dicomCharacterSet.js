// Reading a Part 10 file whose Specific Character Set is ISO_IR 192 (UTF-8). dcmjs decodes the
// top-level text of such a file as UTF-8 but every sequence item with its default decoder: the items
// are read from new streams that do not take the file's decoder. A DICOM-SR document holds all its
// text (code meanings, text values, names) in sequence items, so text outside ASCII would read
// garbled. That default decoder ('latin1', which TextDecoder implements as windows-1252) gives each
// byte one character, so the bytes are recovered through its own table and decoded again as UTF-8;
// text that is not valid UTF-8 is kept as read.
//
// An item's character set is the one it declares, else the one in effect where it is nested. An item
// that declares one is decoded with it by dcmjs and its own text is left as read; an item that does not
// is repaired only when the set in effect is UTF-8. dcmjs replaces every declared value with
// "ISO_IR 192": the declared value is read from the element's raw value.

import dcmjs from 'dcmjs';

const SPECIFIC_CHARACTER_SET = '00080005';
// The value representations dcmjs decodes with the file's character set
const ENCODED_VRS = ['SH', 'LO', 'ST', 'PN', 'LT', 'UT', 'UC'];

// The character set a dictionary declares (as written in the file), or undefined
function declaredCharacterSet(dict) {
  const element = dict && dict[SPECIFIC_CHARACTER_SET];
  if (!element) {
    return undefined;
  }
  const values = Array.isArray(element._rawValue) ? element._rawValue : element.Value;
  const value = Array.isArray(values) ? values.find(item => typeof item === 'string' && item.trim() !== '') : undefined;
  return value === undefined ? '' : value.trim();
}

const isUtf8 = characterSet => typeof characterSet === 'string'
  && characterSet.replace(/[_ ]/g, '-').toUpperCase() === 'ISO-IR-192';

let utf8;
let byteOf;
function asUtf8(text) {
  // The text dcmjs's default decoding of UTF-8 bytes gave, decoded as UTF-8; unchanged when it is not
  if (typeof text !== 'string' || !Array.from(text).some(character => character.charCodeAt(0) > 0x7f)) {
    return text;
  }
  if (!byteOf) {
    const latin1 = new TextDecoder('latin1');
    byteOf = new Map(Array.from({ length: 256 }, (_, byte) => [latin1.decode(Uint8Array.of(byte)), byte]));
    utf8 = new TextDecoder('utf-8', { fatal: true });
  }
  const characters = Array.from(text);
  if (!characters.every(character => byteOf.has(character))) {
    return text;
  }
  try {
    return utf8.decode(Uint8Array.from(characters, character => byteOf.get(character)));
  } catch (error) {
    return text;
  }
}

const repairValue = (value) => {
  if (typeof value === 'string') {
    return asUtf8(value);
  }
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    // A person name's components
    return Object.fromEntries(Object.entries(value).map(([key, component]) => [key, asUtf8(component)]));
  }
  return value;
};

function repairItem(item, inherited) {
  // The text of one sequence item read with dcmjs's default decoder, in the set in effect for it, and
  // of the items nested in it
  const declared = declaredCharacterSet(item);
  const characterSet = declared === undefined ? inherited : declared;
  Object.values(item).forEach((element) => {
    if (!element || !Array.isArray(element.Value)) {
      return;
    }
    if (element.vr === 'SQ') {
      element.Value.forEach(nested => nested && repairItem(nested, characterSet));
    } else if (declared === undefined && isUtf8(characterSet) && ENCODED_VRS.includes(element.vr)) {
      element.Value = element.Value.map(repairValue);
    }
  });
}

/**
 * The text of the sequence items of a dcmjs dictionary whose character set in effect is UTF-8 (the
 * file's, or one an enclosing item declares), decoded as UTF-8 (in place). An item that declares its
 * own set, and an item in any other set, is left as it is.
 *
 * @param {object} dict - `DicomMessage.readFile(...).dict`
 * @returns {object} the dictionary
 */
function repairNestedText(dict) {
  const characterSet = declaredCharacterSet(dict);
  Object.values(dict)
    .filter(element => element && element.vr === 'SQ' && Array.isArray(element.Value))
    .forEach(element => element.Value.forEach(item => item && repairItem(item, characterSet)));
  return dict;
}

/** `DicomMessage.readFile`, with the text of the sequence items in UTF-8 decoded as UTF-8 */
function readDicomFile(buffer, options) {
  const dicomData = dcmjs.data.DicomMessage.readFile(buffer, options);
  repairNestedText(dicomData.dict);
  return dicomData;
}


export { readDicomFile, repairNestedText };
