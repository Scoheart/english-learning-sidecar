import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  badge?: string;
  badgeClass?: string;
}

interface CustomSelectProps<T extends string = string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
  className?: string;
}

export function CustomSelect<T extends string = string>({
  id,
  value,
  options,
  disabled,
  onChange,
  className,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={cn(
          'group flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background/95 px-3 py-2 text-left text-xs shadow-2xs transition-all duration-200',
          'hover:border-primary/45 hover:bg-accent/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
          open && 'border-primary ring-2 ring-primary/15 bg-background',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {selected?.badge && (
            <span
              className={cn(
                'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                selected.badgeClass || 'border-primary/25 bg-primary/10 text-primary',
              )}
            >
              {selected.badge}
            </span>
          )}
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{selected?.label}</span>
            {selected?.description && (
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                · {selected.description}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-foreground',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="animate-dropdown-in absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-border/80 bg-popover/98 p-1.5 text-popover-foreground shadow-lg backdrop-blur-md"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-start justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all duration-150',
                  isSelected
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-foreground/90 hover:bg-muted/70',
                )}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {opt.badge && (
                      <span
                        className={cn(
                          'rounded border px-1.5 py-0 text-[10px] font-semibold',
                          opt.badgeClass || 'border-primary/25 bg-primary/10 text-primary',
                        )}
                      >
                        {opt.badge}
                      </span>
                    )}
                    <span className="font-medium text-foreground">{opt.label}</span>
                  </div>
                  {opt.description && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {opt.description}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-transform duration-150',
                    isSelected ? 'bg-primary text-primary-foreground scale-100' : 'opacity-0 scale-75',
                  )}
                >
                  <Check className="h-2.5 w-2.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface StyledCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}

export function StyledCheckbox({ checked, disabled, onChange, children }: StyledCheckboxProps) {
  return (
    <label
      className={cn(
        'group flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-xs transition-all duration-200 hover:border-primary/35 hover:bg-muted/45',
        checked && 'border-primary/40 bg-primary/[0.06]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-all duration-200',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30',
          checked
            ? 'border-primary bg-primary text-primary-foreground shadow-2xs scale-100'
            : 'border-input bg-background group-hover:border-primary/50',
        )}
      >
        <Check
          className={cn(
            'h-2.5 w-2.5 stroke-[2.5] transition-transform duration-150',
            checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
          )}
        />
      </span>
      <span className="leading-relaxed text-foreground/90">{children}</span>
    </label>
  );
}

export function getPosBadgeStyle(pos?: string): string {
  const clean = (pos || '').toLowerCase();
  if (clean.includes('v')) {
    return 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  }
  if (clean.includes('n')) {
    return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  }
  if (clean.includes('adj') || clean.includes('adv')) {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }
  return 'border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300';
}

export interface ConstituentColorTheme {
  name: string;
  cardBorder: string;
  cardBg: string;
  badge: string;
  fragmentPill: string;
  dot: string;
  explanationBorder: string;
}

const CONSTITUENT_THEMES: Record<string, ConstituentColorTheme> = {
  subject: {
    name: 'sky',
    cardBorder: 'border-sky-500/30 hover:border-sky-500/60',
    cardBg: 'bg-sky-500/[0.05] dark:bg-sky-500/[0.08]',
    badge: 'border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-200',
    fragmentPill: 'bg-sky-500/12 text-sky-900 dark:text-sky-100 border-sky-500/25',
    dot: 'bg-sky-500',
    explanationBorder: 'border-l-2 border-sky-500/60',
  },
  verb: {
    name: 'rose',
    cardBorder: 'border-rose-500/30 hover:border-rose-500/60',
    cardBg: 'bg-rose-500/[0.05] dark:bg-rose-500/[0.08]',
    badge: 'border-rose-500/30 bg-rose-500/15 text-rose-800 dark:text-rose-200',
    fragmentPill: 'bg-rose-500/12 text-rose-900 dark:text-rose-100 border-rose-500/25',
    dot: 'bg-rose-500',
    explanationBorder: 'border-l-2 border-rose-500/60',
  },
  object: {
    name: 'emerald',
    cardBorder: 'border-emerald-500/30 hover:border-emerald-500/60',
    cardBg: 'bg-emerald-500/[0.05] dark:bg-emerald-500/[0.08]',
    badge: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
    fragmentPill: 'bg-emerald-500/12 text-emerald-900 dark:text-emerald-100 border-emerald-500/25',
    dot: 'bg-emerald-500',
    explanationBorder: 'border-l-2 border-emerald-500/60',
  },
  modifier: {
    name: 'amber',
    cardBorder: 'border-amber-500/30 hover:border-amber-500/60',
    cardBg: 'bg-amber-500/[0.05] dark:bg-amber-500/[0.08]',
    badge: 'border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-200',
    fragmentPill: 'bg-amber-500/12 text-amber-900 dark:text-amber-100 border-amber-500/25',
    dot: 'bg-amber-500',
    explanationBorder: 'border-l-2 border-amber-500/60',
  },
  clause: {
    name: 'violet',
    cardBorder: 'border-violet-500/30 hover:border-violet-500/60',
    cardBg: 'bg-violet-500/[0.05] dark:bg-violet-500/[0.08]',
    badge: 'border-violet-500/30 bg-violet-500/15 text-violet-800 dark:text-violet-200',
    fragmentPill: 'bg-violet-500/12 text-violet-900 dark:text-violet-100 border-violet-500/25',
    dot: 'bg-violet-500',
    explanationBorder: 'border-l-2 border-violet-500/60',
  },
};

const THEME_ROTATION = [
  CONSTITUENT_THEMES.subject,
  CONSTITUENT_THEMES.verb,
  CONSTITUENT_THEMES.object,
  CONSTITUENT_THEMES.modifier,
  CONSTITUENT_THEMES.clause,
];

export function getConstituentTheme(role: string, index: number): ConstituentColorTheme {
  const r = (role || '').toLowerCase();
  if (r.includes('主') || r.includes('subject')) return CONSTITUENT_THEMES.subject;
  if (r.includes('谓') || r.includes('动') || r.includes('verb') || r.includes('predicate') || r.includes('modal')) {
    return CONSTITUENT_THEMES.verb;
  }
  if (r.includes('宾') || r.includes('表') || r.includes('object') || r.includes('complement')) {
    return CONSTITUENT_THEMES.object;
  }
  if (r.includes('状') || r.includes('修') || r.includes('目的') || r.includes('条件') || r.includes('介') || r.includes('adverb') || r.includes('modifier') || r.includes('prep')) {
    return CONSTITUENT_THEMES.modifier;
  }
  if (r.includes('定') || r.includes('从句') || r.includes('同位') || r.includes('clause') || r.includes('attribute')) {
    return CONSTITUENT_THEMES.clause;
  }
  return THEME_ROTATION[index % THEME_ROTATION.length];
}

export function getCorrectionStatusMeta(status?: string): { label: string; className: string } {
  switch (status) {
    case 'natural':
      return {
        label: '表达地道 · Natural',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      };
    case 'natural_but_improvable':
      return {
        label: '可进一步润色 · Improvable',
        className: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
      };
    case 'needs_correction':
      return {
        label: '建议修正 · Needs Fix',
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      };
    default:
      return {
        label: '母语级工程表达 · Native Rewrite',
        className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      };
  }
}
