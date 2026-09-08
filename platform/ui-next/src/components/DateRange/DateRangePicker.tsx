import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import { Calendar } from '../Calendar';
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from '../Popover';

export type DateRange = {
  from?: Date;
  to?: Date;
};

export type DateRangePickerProps = {
  /** Currently selected range. Either end may be absent. */
  value?: DateRange;
  /** Called with the new range whenever an end is picked, typed or cleared. */
  onChange: (range: DateRange) => void;
  /** Days the user may not pick. */
  disabled?: (date: Date) => boolean;
  /** Rendered inside the start calendar, below it. Used for date presets. */
  footer?: React.ReactNode;
  className?: string;
  /** Applied to each field. The default uses ui-next's own tokens, whose `--input` is aqua; the
   *  study list overrides it to match its grey filter controls. */
  inputClassName?: string;
  /** Applied to each calendar popover, for the same reason. */
  contentClassName?: string;
  id?: string;
};

const DISPLAY_FORMAT = 'MM/DD/YYYY';

function format(date?: Date) {
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `${mm}/${dd}/${date.getFullYear()}`;
}

/** MM/DD/YYYY only, and only when it denotes the date it spells -- 02/31/2020 is not a date. */
function parse(text: string): Date | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) {
    return undefined;
  }

  const [, mm, dd, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

  const roundTrips =
    date.getFullYear() === Number(yyyy) &&
    date.getMonth() === Number(mm) - 1 &&
    date.getDate() === Number(dd);

  return roundTrips ? date : undefined;
}

// Years a study or a birth date can plausibly fall in. The month/year dropdowns need an explicit
// range, and without a wide one a birth date is unreachable without paging a month at a time.
const FIRST_MONTH = new Date(1900, 0);
const LAST_MONTH = new Date(new Date().getFullYear() + 1, 11);

type FieldProps = {
  id?: string;
  placeholder: string;
  date?: Date;
  onPick: (date: Date | undefined) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: (date: Date) => boolean;
  footer?: React.ReactNode;
  inputClassName?: string;
  contentClassName?: string;
  dataCy: string;
};

/** One text field that is also the trigger for its own single-date calendar. */
function DateField({
  id,
  placeholder,
  date,
  onPick,
  open,
  onOpenChange,
  disabled,
  footer,
  inputClassName,
  contentClassName,
  dataCy,
}: FieldProps) {
  const [text, setText] = React.useState(format(date));

  // The field is editable, so it holds text while it is being typed and only reports a date once
  // that text denotes one. Re-synced when the value changes from outside, e.g. a preset.
  React.useEffect(() => setText(format(date)), [date]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <input
          id={id}
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={event => {
            const next = event.target.value;
            setText(next);

            const parsed = parse(next);
            if (parsed && !disabled?.(parsed)) {
              onPick(parsed);
            } else if (next === '') {
              onPick(undefined);
            }
          }}
          className={cn(
            'h-7 w-full rounded border border-input bg-background px-1.5 py-1 text-left text-sm font-normal placeholder:text-muted-foreground focus:border-ring focus:outline-none',
            inputClassName
          )}
          data-cy={dataCy}
        />
      </PopoverTrigger>
      {/* Portalled: these fields sit in study-list headers and filter rows whose overflow would
          otherwise clip the calendar. */}
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={cn('w-auto overflow-hidden p-0', contentClassName)}
        >
          <Calendar
            mode="single"
            captionLayout="dropdown"
            startMonth={FIRST_MONTH}
            endMonth={LAST_MONTH}
            defaultMonth={date}
            selected={date}
            onSelect={onPick}
            disabled={disabled}
            numberOfMonths={1}
          />
          {footer ? <div className="border-t border-input px-3 py-2">{footer}</div> : null}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

/**
 * Start and end date fields, each editable and each its own calendar.
 *
 * This is the shape OHIF v3 uses in its study list. A single range calendar behind an icon reads
 * as a different control from the rest of the filter row and gives no way to type a date.
 */
export function DateRangePicker({
  value,
  onChange,
  disabled,
  footer,
  className,
  inputClassName,
  contentClassName,
  id = 'date-range',
}: DateRangePickerProps) {
  const { t } = useTranslation('DatePicker');
  const [openStart, setOpenStart] = React.useState(false);
  const [openEnd, setOpenEnd] = React.useState(false);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DateField
        id={`${id}-start`}
        dataCy="input-date-range-start"
        inputClassName={inputClassName}
        contentClassName={contentClassName}
        placeholder={t('Start Date', DISPLAY_FORMAT)}
        date={value?.from}
        open={openStart}
        onOpenChange={setOpenStart}
        disabled={disabled}
        footer={footer}
        onPick={from => {
          onChange({ from, to: value?.to });
          if (from) {
            // Picking a start moves the user on, which is what the range control did.
            setOpenStart(false);
            setOpenEnd(true);
          }
        }}
      />
      <DateField
        id={`${id}-end`}
        dataCy="input-date-range-end"
        inputClassName={inputClassName}
        contentClassName={contentClassName}
        placeholder={t('End Date', DISPLAY_FORMAT)}
        date={value?.to}
        open={openEnd}
        onOpenChange={setOpenEnd}
        disabled={disabled}
        onPick={to => {
          onChange({ from: value?.from, to });
          if (to) {
            setOpenEnd(false);
          }
        }}
      />
    </div>
  );
}

export default DateRangePicker;
