import { useState, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

/** Multi-select filter pill with an optional search box. */
export function FilterMenu({
  label,
  options,
  selected,
  onChange,
  searchable,
  single,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
  single?: boolean;
}) {
  const [q, setQ] = useState('');
  const active = selected.length > 0;
  const summary = active ? (selected.length === 1 ? options.find((o) => o.value === selected[0])?.label : `${selected.length} selected`) : null;
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover onOpenChange={(o) => !o && setQ('')}>
      <div className={cn('inline-flex h-8 items-center rounded-md border text-[13px] shadow-sm transition-colors', active ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-700 hover:border-slate-300')}>
        <PopoverTrigger asChild>
          <button className="flex h-full items-center gap-1.5 rounded-md px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
            <span className={cn(active ? 'text-brand-600' : 'text-ink-500')}>{label}</span>
            {summary && <span className="max-w-[140px] truncate font-medium">{summary}</span>}
            {!active && <ChevronDown className="size-3.5 text-ink-400" />}
          </button>
        </PopoverTrigger>
        {active && (
          <button onClick={() => onChange([])} className="mr-1 rounded p-0.5 text-brand-500 hover:bg-brand-100 hover:text-brand-800" aria-label={`Clear ${label} filter`}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-60 p-1">
        {searchable && (
          <div className="mb-1 flex items-center gap-2 border-b border-line px-2 pb-1.5 pt-1">
            <Search className="size-3.5 text-ink-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className="h-6 flex-1 bg-transparent text-[13px] focus:outline-none" />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto">
          {shown.length === 0 && <p className="px-2 py-3 text-center text-xs text-ink-400">No matches</p>}
          {shown.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-800 hover:bg-slate-100">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => onChange(single ? (v ? [o.value] : []) : v ? [...selected, o.value] : selected.filter((s) => s !== o.value))}
                />
                {o.icon}
                <span className="flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="text-2xs tabular-nums text-ink-400">{o.count}</span>}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
