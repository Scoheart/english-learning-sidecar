import React, { useEffect, useState } from 'react';
import { ArrowRight, History, Star, Trash2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TaskStatusBadge, type TaskStatus } from '@/components/task-status-badge';
import { requireOk } from '@/lib/reliability.js';
import { type FavoriteCategory, type FavoriteItem, type RenderFavorite } from './favorite-button';

export interface HistoryItem {
  id: string;
  term: string;
  meaning: string;
  category: FavoriteCategory | 'analysis';
  encounters: number;
  last_seen: string;
  event_id: string | null;
  status?: TaskStatus;
}
export const CATEGORY_LABELS = { all: '全部', analysis: '查询与分析', vocabulary: '单词', grammar: '语法', example: '例句' } as const;
type Category = keyof typeof CATEGORY_LABELS;
const PAGE_SIZE = 60;

export function CollectionCards({ items, mode, renderFavorite, onRemove, onOpenEvent, onSpeak, busy }: {
  items: (FavoriteItem | HistoryItem)[];
  mode: 'favorites' | 'history';
  renderFavorite: RenderFavorite;
  onRemove: (item: FavoriteItem) => void;
  onOpenEvent: (id: string) => void;
  onSpeak: (text: string) => void;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(item => {
        const isHistory = 'encounters' in item;
        const eventId = item.event_id;
        return (
          <Card key={`${item.category}-${item.id}`} className="surface-card flex min-w-0 flex-col border-border/70 shadow-sm">
            <CardHeader className="space-y-3 pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="secondary" className="text-[11px]">{CATEGORY_LABELS[item.category]}</Badge>
                {mode === 'history' && isHistory && <span className="text-xs tabular-nums text-muted-foreground">{item.category === 'analysis' ? '查询' : '出现'} {item.encounters} 次</span>}
              </div>
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 break-words font-editorial text-base font-semibold leading-relaxed text-balance">{item.term}</h2>
                <div className="flex shrink-0 items-center">
                  {item.category !== 'analysis' && renderFavorite({ term: item.term, meaning: item.meaning, category: item.category, ...(eventId ? { eventId } : {}) })}
                  {(item.category === 'vocabulary' || item.category === 'example') && <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={`朗读 ${item.term}`} onClick={() => onSpeak(item.term)}><Volume2 aria-hidden="true" className="size-3.5" /></Button>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              {item.meaning && <p className="break-words whitespace-pre-wrap text-pretty text-xs leading-relaxed text-foreground/85">{item.meaning}</p>}
              {isHistory && item.status && <div><TaskStatusBadge status={item.status} /></div>}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                {eventId ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onOpenEvent(eventId)} className="h-7 gap-1 px-0 text-xs text-muted-foreground">查看完整分析<ArrowRight aria-hidden="true" className="size-3" /></Button> : <span className="text-[11px] text-muted-foreground">原始分析已删除</span>}
                {mode === 'favorites' && !isHistory && <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" aria-label={`取消收藏 ${item.term}`} disabled={busy} onClick={() => onRemove(item)}><Trash2 aria-hidden="true" className="size-3.5" /></Button>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function CollectionView({ mode, favorites, search, revision, renderFavorite, onRemove, onOpenEvent, onSpeak, onGoToPrompts, busy }: {
  mode: 'favorites' | 'history';
  favorites: FavoriteItem[];
  search: string;
  revision: number;
  renderFavorite: RenderFavorite;
  onRemove: (item: FavoriteItem) => void;
  onOpenEvent: (id: string) => void;
  onSpeak: (text: string) => void;
  onGoToPrompts: () => void;
  busy: boolean;
}) {
  const [category, setCategory] = useState<Category>('all');
  const [page, setPage] = useState(0);
  const queryKey = JSON.stringify([search, category, page]);
  const [result, setResult] = useState<{ history: HistoryItem[]; total: number; key: string }>({ history: [], total: 0, key: '' });
  const [loading, setLoading] = useState(mode === 'history');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setPage(0); }, [search]);
  useEffect(() => {
    if (mode !== 'history') return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: search, category, offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
    fetch(`/api/history?${params}`, { signal: controller.signal })
      .then(requireOk).then(response => response.json())
      .then(data => {
        if (controller.signal.aborted) return;
        if (page > 0 && page * PAGE_SIZE >= data.total) { setPage(0); return; }
        setResult({ ...data, key: JSON.stringify([search, category, page]) });
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '历史记录加载失败，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, search, category, page, revision, retry]);

  const categories: Category[] = mode === 'history' ? ['all', 'analysis', 'vocabulary', 'grammar', 'example'] : ['all', 'vocabulary', 'grammar', 'example'];
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  const q = normalize(search);
  const filtered = favorites.filter(item => (category === 'all' || item.category === category)
    && (!q || normalize(`${item.term} ${item.meaning}`).includes(q)));
  const items = mode === 'history' ? result.history : filtered;
  const total = mode === 'history' ? result.total : filtered.length;
  const title = mode === 'history' ? 'History' : '我的收藏';
  return (
    <section className="mx-auto w-full max-w-[1600px] space-y-5 px-5 py-6 sm:px-6 lg:px-8 lg:py-8" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-balance">{mode === 'history' ? <History aria-hidden="true" className="size-5" /> : <Star aria-hidden="true" className="size-5" />}{title}</h1>
          <p className="text-pretty text-xs text-muted-foreground">{mode === 'history' ? '所有查询与分析，以及其中出现的单词、语法和例句。相同内容累计计数。' : '收藏值得回看的单词、词组、语法和例句。'}</p>
        </div>
        <Badge variant="outline" className="tabular-nums">{total} 项</Badge>
      </header>
      <Tabs value={category} onValueChange={value => { setCategory(value as Category); setPage(0); }}>
        <TabsList aria-label={mode === 'history' ? '历史记录分类' : '收藏分类'} className="h-auto max-w-full flex-wrap justify-start">
          {categories.map(value => <TabsTrigger key={value} value={value} className="text-xs">{CATEGORY_LABELS[value]}</TabsTrigger>)}
        </TabsList>
        {categories.map(value => <TabsContent key={value} value={value} className="mt-4 animate-none" aria-busy={mode === 'history' && loading}>
          {mode === 'history' && loading && result.key !== queryKey ? <p role="status" className="py-12 text-center text-xs text-muted-foreground">正在加载历史记录…</p>
            : error && mode === 'history' ? <div className="space-y-3 py-8"><p role="alert" className="text-xs text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
              : items.length > 0 ? <CollectionCards items={items} mode={mode} renderFavorite={renderFavorite} onRemove={onRemove} onOpenEvent={onOpenEvent} onSpeak={onSpeak} busy={busy} />
                : <div className="space-y-3 rounded-xl border border-dashed px-5 py-12 text-center">
                  <h2 className="text-sm font-medium text-balance">{search.trim() ? '没有匹配的内容' : mode === 'favorites' ? '这里还没有收藏' : '还没有历史记录'}</h2>
                  <p className="text-pretty text-xs text-muted-foreground">{search.trim() ? '试试其他关键词，或清空搜索。' : mode === 'favorites' ? '在分析或 History 中点击星星，即可将内容加入收藏。' : '查询或分析过的内容会自动保存在这里。'}</p>
                  <Button variant="outline" size="sm" onClick={onGoToPrompts}>查看 Prompts</Button>
                </div>}
        </TabsContent>)}
      </Tabs>
      {mode === 'history' && !loading && !error && total > PAGE_SIZE && <nav aria-label="历史记录分页" className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
        <span className="text-xs tabular-nums text-muted-foreground">第 {page + 1} / {Math.ceil(total / PAGE_SIZE)} 页</span>
        <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(value => value + 1)}>下一页</Button>
      </nav>}
    </section>
  );
}
