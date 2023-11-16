import { bidirectional, targetCR, targetNE, targetUN } from '../tools';

export const targets = {
  id: 'targets',
  name: 'Targets',
  childTools: [bidirectional, targetCR, targetUN, targetNE],
  options: {
    caseProgress: {
      include: true,
      evaluate: true,
    },
  },
};
