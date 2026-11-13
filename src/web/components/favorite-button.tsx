import React from 'react';
import { CircleAlert, Star, StarOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FavoriteCategory = 'vocabulary' | 'grammar' | 'example';
export interface FavoriteInput {
  term: string;
  meaning: string;
  category: FavoriteCategory;
  eventId?: string;
}
export interface FavoriteItem extends FavoriteInput {
  id: string;
  created_at: string;
  event_id?: string | null;
}
export type RenderFavorite = (item: FavoriteInput) => React.ReactNode;

export function favoriteKey(item: Pick<FavoriteInput, 'category' | 'term'>): string {
  return `${item.category}:${item.term.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()}`;
}

export function FavoriteButton({ item, saved, disabled, onToggle }: {
  item: FavoriteInput;
  saved: boolean;
  disabled?: boolean;
  onToggle: (item: FavoriteInput) => void;
}) {
  const label = saved ? `取消收藏 ${item.term}` : `收藏 ${item.term}`;
  return (
    <Button type="button" variant="ghost" size="icon" disabled={disabled}
      aria-label={label} aria-pressed={saved} title={saved ? '取消收藏' : '加入我的收藏'}
      className={cn('size-7 shrink-0', saved ? 'text-primary' : 'text-muted-foreground hover:text-primary')}
      onClick={() => onToggle(item)}>
      <Star aria-hidden="true" className={cn('size-3.5', saved && 'fill-current')} />
    </Button>
  );
}

type FavoriteFeedback = { kind: 'success' | 'removed' | 'error'; message: string };
export type { FavoriteFeedback };
export function FavoriteNotice({ feedback }: { feedback: FavoriteFeedback | null }) {
  const Icon = feedback?.kind === 'error' ? CircleAlert : feedback?.kind === 'removed' ? StarOff : Star;
  return (
    <div role="status" aria-live="polite" aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      {feedback && <p className={cn('flex max-w-sm items-center gap-2 rounded-lg px-4 py-3 text-pretty text-sm font-medium shadow-lg',
        feedback.kind === 'error' ? 'bg-destructive/85 text-destructive-foreground'
          : feedback.kind === 'removed' ? 'bg-amber-800/85 text-amber-50 dark:bg-amber-400/85 dark:text-amber-950'
          : 'bg-primary/85 text-primary-foreground')}>
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', feedback.kind === 'success' && 'fill-current')} />
        <span>{feedback.message}</span>
      </p>}
    </div>
  );
}
