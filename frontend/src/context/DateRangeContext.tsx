import { createContext, useContext, useState, type ReactNode } from 'react';
import { makePresetRange, type DateRange } from '../components/DateRangeFilter';

interface DateRangeCtx {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
}

const Ctx = createContext<DateRangeCtx | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(() => makePresetRange(28));
  return <Ctx.Provider value={{ dateRange, setDateRange }}>{children}</Ctx.Provider>;
}

export function useDateRange(): DateRangeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDateRange must be inside DateRangeProvider');
  return ctx;
}
