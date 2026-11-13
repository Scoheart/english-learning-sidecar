import React from 'react';
import { CardTitle } from '@/components/ui/card';
import { getPosBadgeStyle } from '@/components/studio-elements';
import { type VocabularyItem } from '@/components/vocabulary-details';
import { cn } from '@/lib/utils';

export function VocabularyHeading({ vocabulary }: { vocabulary: VocabularyItem }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-2">
      <CardTitle className="break-words font-editorial text-lg font-bold text-foreground">
        {vocabulary.term}
      </CardTitle>
      {vocabulary.pos && (
        <span className={cn('rounded border px-1.5 py-0 text-[10px] font-semibold', getPosBadgeStyle(vocabulary.pos))}>
          {vocabulary.pos}
        </span>
      )}
      {vocabulary.phonetic && (
        <span className="break-words rounded bg-muted/80 px-1.5 py-0.5 font-phonetic text-[11px] text-muted-foreground">
          {vocabulary.phonetic}
        </span>
      )}
    </div>
  );
}

export function VocabularyCoreMeanings({ vocabulary }: { vocabulary: VocabularyItem }) {
  const senses = vocabulary.senses ?? [];
  return (
    <section aria-label={`${vocabulary.term} 的核心释义`} className="space-y-1 rounded-r-lg border-l-[3px] border-indigo-500 bg-indigo-500/[0.06] px-2.5 py-2 dark:bg-indigo-500/[0.11]">
      <h3 className="text-balance text-xs font-semibold text-indigo-700 dark:text-indigo-300">核心释义</h3>
      {senses.length > 0 ? (
        <ul className="space-y-1 text-xs font-semibold text-foreground">
          {senses.map((sense, index) => (
            <li key={index} className="break-words text-pretty leading-relaxed">
              <span className="mr-1.5">{sense.pos}</span>{sense.meaning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="break-words text-pretty text-xs font-semibold leading-relaxed text-foreground">{vocabulary.meaning}</p>
      )}
    </section>
  );
}
