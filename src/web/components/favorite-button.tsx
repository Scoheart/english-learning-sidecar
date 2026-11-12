import React from 'react';
import { Star } from 'lucide-react';
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

export function FavoriteButton({ item, saved, disabled, onSave }: {
  item: FavoriteInput;
  saved: boolean;
  disabled?: boolean;
  onSave: (item: FavoriteInput) => void;
}) {
  const label = saved ? `已收藏 ${item.term}` : `收藏 ${item.term}`;
  return (
    <Button type="button" variant="ghost" size="icon" disabled={disabled}
      aria-label={label} title={saved ? '已在收藏夹，无需重复收藏' : '加入我的收藏'}
      className={cn('size-7 shrink-0', saved ? 'text-primary' : 'text-muted-foreground hover:text-primary')}
      onClick={() => onSave(item)}>
      <Star aria-hidden="true" className={cn('size-3.5', saved && 'fill-current')} />
    </Button>
  );
}

type FavoriteFeedback = { kind: 'success' | 'duplicate' | 'error'; message: string };
export type { FavoriteFeedback };
export function FavoriteNotice({ feedback }: { feedback: FavoriteFeedback | null }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {feedback && <p className={cn('rounded-md border px-3 py-2 text-pretty text-xs',
        feedback.kind === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted/60 text-foreground')}>
        {feedback.message}
      </p>}
    </div>
  );
}
