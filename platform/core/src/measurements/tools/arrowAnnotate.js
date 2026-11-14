// An arrow's text wherever a measurement holds it: the classic tool's `text`, a measurement record's
// label (or `metadata.text`, a held record's `data.text`); else the meaning of a coded finding it was
// read with
const arrowText = (data) => {
  if (!data) {
    return '';
  }
  const metadata = data.metadata || {};
  const text = [data.text, data.label, metadata.text, data.data && data.data.text]
    .find(value => typeof value === 'string' && value !== '');
  return text || (metadata.codedFinding && metadata.codedFinding.CodeMeaning) || '';
};

const displayFunction = data => arrowText(data);

export const arrowAnnotate = {
  id: 'ArrowAnnotate',
  name: 'ArrowAnnotate',
  toolGroup: 'allTools',
  cornerstoneToolType: 'ArrowAnnotate',
  options: {
    measurementTable: {
      displayFunction,
    },
    caseProgress: {
      include: true,
      evaluate: true,
    },
  },
};

export { arrowText };
