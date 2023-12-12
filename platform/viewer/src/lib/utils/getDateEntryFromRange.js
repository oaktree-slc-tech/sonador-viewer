export const getDateEntryFromRange = (today, numOfDays, edge = 'start') => {
  if (typeof numOfDays !== 'number') {
    return;
  }

  if (edge === 'end') {
    return today;
  } else {
    today.subtract(numOfDays, 'days');
  }
};
