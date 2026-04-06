import { useState, useRef, useEffect } from 'react';

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const PRESETS: { label: string; days: number }[] = [
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 28 days', days: 28 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 183 },
  { label: 'Last 12 months', days: 365 },
];

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function formatShort(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function makePresetRange(days: number): DateRange {
  const now = new Date();
  const from = startOfDay(new Date(now.getTime() - days * 86400000));
  const to = endOfDay(now);
  const preset = PRESETS.find(p => p.days === days);
  return { from, to, label: preset?.label || `Last ${days} days` };
}

export default function DateRangeFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(toInputDate(value.from));
  const [customTo, setCustomTo] = useState(toInputDate(value.to));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const applyPreset = (days: number) => {
    onChange(makePresetRange(days));
    setOpen(false);
  };

  const applyCustom = () => {
    const from = startOfDay(new Date(customFrom + 'T00:00:00'));
    const to = endOfDay(new Date(customTo + 'T00:00:00'));
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return;
    onChange({ from, to, label: 'Custom' });
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:border-gray-300 transition-colors"
      >
        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{formatShort(value.from)}</span>
        <span className="text-gray-400">-</span>
        <span>{formatShort(value.to)}</span>
        <svg className={`h-3 w-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
          {/* Custom range */}
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Custom Range</p>
          <div className="mb-2 space-y-2">
            <div className="flex items-center gap-2">
              <label className="w-10 text-xs text-gray-500">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-10 text-xs text-gray-500">To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <button
            onClick={applyCustom}
            className="mb-3 w-full rounded-lg bg-blue-600 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>

          {/* Presets */}
          <div className="space-y-0.5">
            {PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => applyPreset(p.days)}
                className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                  value.label === p.label
                    ? 'bg-blue-50 font-medium text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
