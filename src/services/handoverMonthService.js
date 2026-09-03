const VALID_NEW_ASSIGNMENT_MONTHS = new Set(['current', 'next']);

export function isValidNewAssignmentMonth(value) {
  return VALID_NEW_ASSIGNMENT_MONTHS.has(value);
}

function getJstYearMonth(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(now);

  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return { year, month };
}

function shiftYearMonth(year, month, offset) {
  const serialMonth = year * 12 + (month - 1) + offset;
  return {
    year: Math.floor(serialMonth / 12),
    month: (serialMonth % 12) + 1
  };
}

function formatDate(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Resolve the selected new-assignment month into a JST month window.
 * The end date is exclusive so it can be used directly in a SQL range.
 */
export function getNewAssignmentMonthWindow(selection = 'next', now = new Date()) {
  if (!isValidNewAssignmentMonth(selection)) {
    throw new Error(`Invalid new assignment month: ${selection}`);
  }

  const current = getJstYearMonth(now);
  const offset = selection === 'current' ? 0 : 1;
  const target = shiftYearMonth(current.year, current.month, offset);
  const following = shiftYearMonth(target.year, target.month, 1);

  return {
    selection,
    startDate: formatDate(target.year, target.month),
    endDate: formatDate(following.year, following.month),
    label: `${target.year}/${String(target.month).padStart(2, '0')}`
  };
}
