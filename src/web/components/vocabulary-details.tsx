import React from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type RenderFavorite } from '@/components/favorite-button';

export interface LearningExample {
  english: string;
  chinese: string;
  note?: string;
  source?: {
    kind: 'ai' | 'reference';
    title?: string;
    url?: string;
    verification?: 'unverified' | 'not_applicable';
  };
}

interface WordSense {
  pos: string;
  meaning: string;
  example?: LearningExample | null;
}

interface RelatedWord extends WordSense {
  term: string;
  phonetic?: string;
  relationship?: string;
  difference?: string;
}

export interface VocabularyItem {
  term: string;
  phonetic?: string;
  pos?: string;
  meaning: string;
  morphology?: string;
  usage?: string;
  nuance?: string;
  senses?: WordSense[];
  wordFamily?: RelatedWord[];
  synonyms?: RelatedWord[];
  antonyms?: RelatedWord[];
  examples?: LearningExample[];
}

function referenceUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function ExampleAttribution({ example }: { example: LearningExample }) {
  const source = example.source;
  const url = source?.kind === 'reference' ? referenceUrl(source.url) : undefined;
  return (
    <p className="break-words text-pretty text-[11px] leading-relaxed text-muted-foreground">
      {source?.kind === 'ai' ? 'AI 原创例句' : source?.kind === 'reference' ? (
        <>
          引用来源待核实{source.title ? ` · ${source.title}` : ''}
          {url && <> · <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看出处</a></>}
        </>
      ) : '来源未记录'}
    </p>
  );
}

export function VocabularyExample({ example, onSpeak, renderFavorite }: { example: LearningExample; onSpeak: (text: string) => void; renderFavorite?: RenderFavorite }) {
  return (
    <div className="space-y-1 border-l-2 border-border pl-2.5">
      <div className="flex items-start gap-1">
        <p lang="en" className="min-w-0 flex-1 break-words text-pretty text-xs font-medium leading-relaxed text-foreground">{example.english}</p>
        {renderFavorite?.({ term: example.english, meaning: example.chinese, category: 'example' })}
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={`朗读例句 ${example.english}`} onClick={() => onSpeak(example.english)}>
          <Volume2 aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <p className="break-words text-pretty text-xs leading-relaxed text-foreground/90">{example.chinese}</p>
      <ExampleAttribution example={example} />
    </div>
  );
}

function WordList({ words, onSpeak, contrast = false, renderFavorite }: { words: RelatedWord[]; onSpeak: (text: string) => void; contrast?: boolean; renderFavorite?: RenderFavorite }) {
  return (
    <ul className="space-y-3">
      {words.map((word, index) => (
        <li key={`${word.term}-${index}`} className="min-w-0 space-y-1.5">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1 break-words text-pretty leading-relaxed">
              <span lang="en" className="font-semibold text-foreground">{word.term}</span>
              {word.phonetic && <span className="ml-1.5 font-phonetic text-[11px] text-muted-foreground">{word.phonetic}</span>}
              {word.pos && <span className="ml-1.5 font-medium text-muted-foreground">{word.pos}</span>}
              <span className="ml-1.5 text-foreground/85">{word.meaning}</span>
            </div>
            {renderFavorite?.({ term: word.term, meaning: word.meaning, category: 'vocabulary' })}
            <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={`朗读 ${word.term}`} onClick={() => onSpeak(word.term)}>
              <Volume2 aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
          {word.relationship && <p className="break-words text-pretty leading-relaxed text-muted-foreground">{word.relationship}</p>}
          {contrast && word.difference && <p className="break-words text-pretty leading-relaxed text-foreground/85"><span className="font-medium">区别：</span>{word.difference}</p>}
          {word.example && <VocabularyExample example={word.example} onSpeak={onSpeak} renderFavorite={renderFavorite} />}
        </li>
      ))}
    </ul>
  );
}

export function VocabularyDetails({ vocabulary, onSpeak, renderFavorite }: { vocabulary: VocabularyItem; onSpeak: (text: string) => void; renderFavorite?: RenderFavorite }) {
  const senses = vocabulary.senses ?? [];
  const family = vocabulary.wordFamily ?? [];
  const allExamples = [...(vocabulary.examples ?? []), ...senses.flatMap(sense => sense.example ? [sense.example] : [])];
  const examples = allExamples.filter((example, index) => allExamples.findIndex(candidate =>
    candidate.english.trim() === example.english.trim() && candidate.chinese.trim() === example.chinese.trim()) === index);
  const hasRelations = vocabulary.synonyms !== undefined || vocabulary.antonyms !== undefined;
  return (
    <>
      {examples.length > 0 && (
        <section aria-label={`${vocabulary.term} 的用法例句`} className="space-y-2">
          <p className="text-balance text-xs font-semibold text-foreground">用法例句</p>
          {examples.map((example, index) => <VocabularyExample key={index} example={example} onSpeak={onSpeak} renderFavorite={renderFavorite} />)}
        </section>
      )}
      {family.length > 0 && (
        <section aria-label={`${vocabulary.term} 的同源词派生`} className="space-y-2 border-t border-border/60 pt-2.5">
          <p className="text-balance text-xs font-semibold text-foreground">同源词派生</p>
          <WordList words={family} onSpeak={onSpeak} renderFavorite={renderFavorite} />
        </section>
      )}
      {hasRelations && (
        <Tabs key={vocabulary.term} defaultValue="synonyms" className="min-w-0 border-t border-border/60 pt-2.5">
          <TabsList aria-label={`${vocabulary.term} 的同反义词`} className="relation-tabs h-auto max-w-full gap-1 border-0 bg-accent/50">
            <TabsTrigger value="synonyms" className="px-2.5 text-xs">同义词</TabsTrigger>
            <TabsTrigger value="antonyms" className="px-2.5 text-xs">反义词</TabsTrigger>
          </TabsList>
          <TabsContent value="synonyms" className="mt-3 animate-none">
            {(vocabulary.synonyms?.length ?? 0) > 0
              ? <WordList words={vocabulary.synonyms!} onSpeak={onSpeak} renderFavorite={renderFavorite} contrast />
              : <p className="text-pretty text-xs leading-relaxed text-muted-foreground">暂无适合当前词义的同义词；可先结合例句理解用法。</p>}
          </TabsContent>
          <TabsContent value="antonyms" className="mt-3 animate-none">
            {(vocabulary.antonyms?.length ?? 0) > 0
              ? <WordList words={vocabulary.antonyms!} onSpeak={onSpeak} renderFavorite={renderFavorite} contrast />
              : <p className="text-pretty text-xs leading-relaxed text-muted-foreground">暂无适合当前词义的直接反义词；可先结合例句理解用法。</p>}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
