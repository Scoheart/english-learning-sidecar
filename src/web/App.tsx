import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
  ArrowRight,
  Layers,
  GitBranch,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface VocabularyItem {
  term: string;
  phonetic?: string;
  pos?: string;
  meaning: string;
  morphology?: string;
  usage?: string;
  nuance?: string;
}

interface SentenceConstituent {
  role: string;
  fragment: string;
  explanation: string;
}

interface SentenceAnatomy {
  pattern?: string;
  tense?: string;
  voice?: string;
  constituents?: SentenceConstituent[];
}

interface GrammarItem {
  label: string;
  explanation: string;
}

interface DiscourseAnalysis {
  logic?: string;
  cohesion?: string;
  upgradedParagraph?: string;
  upgradedChinese?: string;
}

interface CorrectionItem {
  before: string;
  after: string;
  reason?: string;
}

interface ExampleItem {
  english: string;
  chinese: string;
}

interface Analysis {
  translation: string;
  language: string;
  correctionStatus: string;
  corrections: CorrectionItem[];
  vocabulary: VocabularyItem[];
  sentenceAnatomy?: SentenceAnatomy;
  grammar: GrammarItem[];
  discourse?: DiscourseAnalysis;
  examples: ExampleItem[];
  notes?: string;
  summary?: string;
}

interface SidecarEvent {
  id: string;
  source: string;
  content: string;
  status: 'complete' | 'pending' | 'processing' | 'failed' | 'skipped';
  analysis?: Analysis | null;
  error?: string | null;
  createdAt: string;
}

interface KnowledgeItem {
  id: string;
  term: string;
  meaning: string;
  category: 'vocabulary' | 'grammar';
  encounters: number;
  last_seen: string;
}

interface SidecarStatus {
  mode: 'live' | 'demo';
  model: string;
  paused: boolean;
  demoEnabled: boolean;
  stats: {
    total: number;
    complete: number;
    pending: number;
    failed: number;
    knowledge: number;
    sources: { source: string; count: number }[];
  };
}

const AGENT_NAMES: Record<string, string> = {
  codex: 'Codex',
  cursor: 'Cursor',
  claude: 'Claude Code',
  qoder: 'Qoder',
  pi: 'Pi',
  dsh: 'DSH',
  grok: 'Grok Build',
  manual: 'Demo',
};

const SAMPLE_PROMPTS = [
  '这个 API 需要支持高并发和幂等性处理。',
  '请帮我排查一下内存泄漏的问题，定位具体的泄露点。',
  '帮我重构一遍 UI，现在太丑了。',
  '帮我解释 MCP 的生命周期和 Tool Discovery 机制。',
];

function formatRelativeTime(value: string): string {
  try {
    const diffSec = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(value),
    );
  } catch {
    return '';
  }
}

export default function App() {
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  const [events, setEvents] = useState<SidecarEvent[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainMode, setMainMode] = useState<'feed' | 'knowledge'>('feed');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('sidecar-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    try {
      localStorage.setItem('sidecar-theme', theme);
    } catch {}
  }, [theme]);

  const refreshData = async () => {
    try {
      const [sRes, eRes, kRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/events?limit=120'),
        fetch('/api/knowledge'),
      ]);
      if (!sRes.ok || !eRes.ok || !kRes.ok) return;
      const sData: SidecarStatus = await sRes.json();
      const eData: { events: SidecarEvent[] } = await eRes.json();
      const kData: { knowledge: KnowledgeItem[] } = await kRes.json();

      setStatus(sData);
      setEvents(eData.events || []);
      setKnowledge(kData.knowledge || []);
      setSelectedId((prev) => {
        if (prev && eData.events.some((item) => item.id === prev)) return prev;
        return eData.events[0]?.id || null;
      });
    } catch {
      // Ignore transient network errors
    }
  };

  useEffect(() => {
    refreshData();
    const stream = new EventSource('/api/stream');
    stream.addEventListener('update', refreshData);
    stream.addEventListener('open', refreshData);
    return () => stream.close();
  }, []);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.content.toLowerCase().includes(q) ||
        (e.analysis?.translation || '').toLowerCase().includes(q) ||
        (AGENT_NAMES[e.source] || e.source).toLowerCase().includes(q),
    );
  }, [events, search]);

  const filteredKnowledge = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return knowledge;
    return knowledge.filter(
      (k) => k.term.toLowerCase().includes(q) || k.meaning.toLowerCase().includes(q),
    );
  }, [knowledge, search]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) || filteredEvents[0] || null,
    [events, filteredEvents, selectedId],
  );

  const speak = (text?: string) => {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/\[Demo preview\]/g, '').trim();
    if (speakingText === clean) {
      setSpeakingText(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    setSpeakingText(clean);
    utterance.onend = () => setSpeakingText(null);
    utterance.onerror = () => setSpeakingText(null);
    window.speechSynthesis.speak(utterance);
  };

  const copyTranslation = async (text?: string) => {
    if (!text) return;
    const clean = text.replace(/\[Demo preview\]/g, '').trim();
    try {
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const handleAddSample = async () => {
    const prompt = SAMPLE_PROMPTS[sampleIndex % SAMPLE_PROMPTS.length];
    setSampleIndex((i) => i + 1);
    const res = await fetch('/api/demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.id) setSelectedId(data.id);
      await refreshData();
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/events/${id}`, { method: 'DELETE' });
    setSelectedId(null);
    await refreshData();
  };

  const handleRetry = async (id: string) => {
    await fetch(`/api/events/${id}/retry`, { method: 'POST' });
    await refreshData();
  };

  const handleTogglePause = async (checked: boolean) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: !checked }),
    });
    await refreshData();
  };

  const analysis = selectedEvent?.analysis;
  const cleanHeroEnglish = analysis?.translation?.replace(/\s*\[Demo preview\]\s*/g, '') || '';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar: Clean shadcn/ui Navigation & Single-Line History */}
      <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/20">
        {/* Brand Header */}
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold tracking-tight">English Sidecar</span>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
              {status?.mode === 'live' ? 'Live' : 'Demo'}
            </Badge>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Mode Switcher + Search */}
        <div className="space-y-2.5 px-3 pb-3">
          <Tabs
            value={mainMode}
            onValueChange={(v) => setMainMode(v as 'feed' | 'knowledge')}
            className="w-full"
          >
            <TabsList className="grid h-8 w-full grid-cols-2">
              <TabsTrigger value="feed" className="text-xs">
                Prompts ({status?.stats.total ?? events.length})
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="text-xs">
                Lexicon ({status?.stats.knowledge ?? knowledge.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={mainMode === 'feed' ? 'Search prompts...' : 'Search vocabulary...'}
              className="h-8 bg-background pl-8 text-xs"
            />
          </div>
        </div>

        <Separator />

        {/* Minimalist Prompt History List */}
        <ScrollArea className="flex-1 px-2 py-2">
          {mainMode === 'feed' ? (
            <div className="space-y-1">
              {filteredEvents.length === 0 ? (
                <div className="px-3 py-10 text-center text-xs text-muted-foreground">
                  No prompts yet.
                </div>
              ) : (
                filteredEvents.map((item) => {
                  const isSelected = selectedEvent?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`group flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'bg-accent text-accent-foreground font-medium shadow-2xs'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      }`}
                    >
                      <span className="truncate text-[13px] leading-snug text-foreground">
                        {item.content}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            item.status === 'complete'
                              ? 'bg-emerald-500'
                              : item.status === 'failed'
                                ? 'bg-destructive'
                                : 'bg-amber-500'
                          }`}
                        />
                        <span>{AGENT_NAMES[item.source] || item.source}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(item.createdAt)}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-1 px-2 py-2 text-xs text-muted-foreground">
              <p className="leading-relaxed">
                Showing {filteredKnowledge.length} saved vocabulary terms and grammar structures
                accumulated from your prompts.
              </p>
            </div>
          )}
        </ScrollArea>

        {/* Quiet Footer */}
        <div className="summary-strip flex h-11 items-center justify-between border-t px-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>Local SQLite</span>
          </div>
          {status?.demoEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={handleAddSample}
            >
              <Plus className="h-3 w-3" />
              Sample
            </Button>
          )}
        </div>
      </aside>

      {/* Main Content Area: Breathable, Centered, Progressive Disclosure */}
      <main className="flex-1 overflow-y-auto bg-muted/10">
        {mainMode === 'feed' ? (
          selectedEvent ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-6 px-10 py-10">
              {/* 1. Primary Hero Card: The English Expression */}
              <Card className="border-border/80 shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {AGENT_NAMES[selectedEvent.source] || selectedEvent.source}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(selectedEvent.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {analysis && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => speak(cleanHeroEnglish)}
                        >
                          {speakingText === cleanHeroEnglish ? (
                            <VolumeX className="h-3.5 w-3.5" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5" />
                          )}
                          Listen
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => copyTranslation(cleanHeroEnglish)}
                        >
                          {copied ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy English
                            </>
                          )}
                        </Button>
                      </>
                    )}
                    {selectedEvent.status === 'failed' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => handleRetry(selectedEvent.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(selectedEvent.id)}
                      title="Delete prompt"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6 pt-2">
                  {analysis ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <Sparkles className="h-3 w-3" />
                        <span>Native Engineering Expression</span>
                      </div>
                      <p className="text-2xl font-semibold leading-snug tracking-tight text-foreground sm:text-[26px]">
                        {cleanHeroEnglish}
                      </p>
                    </div>
                  ) : (
                    <div className="py-6 text-sm text-muted-foreground">
                      {selectedEvent.error || 'Analyzing prompt in the background...'}
                    </div>
                  )}

                  <Separator />

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Original Prompt
                    </span>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {selectedEvent.content}
                    </p>
                  </div>

                  {/* Subtle Inline Refinement Comparison */}
                  {analysis?.corrections && analysis.corrections.length > 0 && (
                    <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground line-through">
                          {analysis.corrections[0].before}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                          {analysis.corrections[0].after}
                        </span>
                      </div>
                      {analysis.corrections[0].reason && (
                        <p className="mt-1.5 leading-relaxed text-muted-foreground">
                          {analysis.corrections[0].reason}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 2. Systematic 4-Layer Progressive Disclosure Tabs: 字/词 · 句 · 段 · 练 */}
              {analysis && (
                <Tabs defaultValue="lexis" className="w-full">
                  <TabsList className="grid w-full grid-cols-4 sm:w-auto sm:inline-flex">
                    <TabsTrigger value="lexis" className="text-xs">
                      字与词 · Lexis ({analysis.vocabulary?.length || 0})
                    </TabsTrigger>
                    <TabsTrigger value="sentence" className="text-xs">
                      句法拆解 · Sentence
                    </TabsTrigger>
                    <TabsTrigger value="discourse" className="text-xs">
                      篇章成段 · Discourse
                    </TabsTrigger>
                    <TabsTrigger value="examples" className="text-xs">
                      实战举一反三 ({analysis.examples?.length || 0})
                    </TabsTrigger>
                  </TabsList>

                  {/* Tab 1: 字 (Morphology/Roots) & 词 (Collocations/Nuance) */}
                  <TabsContent value="lexis" className="mt-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {analysis.vocabulary?.map((v, idx) => (
                        <Card key={idx} className="flex flex-col border-border/70 shadow-2xs">
                          <CardHeader className="pb-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-baseline gap-2">
                                <CardTitle className="text-base font-semibold tracking-tight">
                                  {v.term}
                                </CardTitle>
                                {v.phonetic && (
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {v.phonetic}
                                  </span>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground"
                                onClick={() => speak(v.term)}
                                title={`Pronounce ${v.term}`}
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <CardDescription className="text-xs font-medium text-foreground/85">
                              {v.meaning}
                            </CardDescription>
                          </CardHeader>

                          <CardContent className="flex flex-1 flex-col justify-between space-y-3 pt-0 text-xs">
                            {v.morphology && (
                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  字源构词 · Morphology
                                </span>
                                <p className="leading-relaxed text-muted-foreground">
                                  {v.morphology}
                                </p>
                              </div>
                            )}

                            {v.nuance && (
                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  词义辨析 · Nuance
                                </span>
                                <p className="leading-relaxed text-muted-foreground">{v.nuance}</p>
                              </div>
                            )}

                            {v.usage && (
                              <div className="rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-foreground/90">
                                {v.usage}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>

                  {/* Tab 2: 句 (Pattern, Tense, Voice, Constituents & Grammar) */}
                  <TabsContent value="sentence" className="mt-4 space-y-4">
                    {analysis.sentenceAnatomy &&
                      (analysis.sentenceAnatomy.pattern ||
                        analysis.sentenceAnatomy.tense ||
                        analysis.sentenceAnatomy.voice) && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <Card className="border-border/70 shadow-2xs">
                            <CardHeader className="pb-1.5 pt-3.5">
                              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider">
                                句子结构 · Pattern
                              </CardDescription>
                              <CardTitle className="text-xs font-semibold leading-snug">
                                {analysis.sentenceAnatomy.pattern || 'SVO 主谓宾结构'}
                              </CardTitle>
                            </CardHeader>
                          </Card>

                          <Card className="border-border/70 shadow-2xs">
                            <CardHeader className="pb-1.5 pt-3.5">
                              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider">
                                时态解析 · Tense
                              </CardDescription>
                              <CardTitle className="text-xs font-semibold leading-snug">
                                {analysis.sentenceAnatomy.tense || '一般现在时 Simple Present'}
                              </CardTitle>
                            </CardHeader>
                          </Card>

                          <Card className="border-border/70 shadow-2xs">
                            <CardHeader className="pb-1.5 pt-3.5">
                              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider">
                                语态解析 · Voice
                              </CardDescription>
                              <CardTitle className="text-xs font-semibold leading-snug">
                                {analysis.sentenceAnatomy.voice || '主动语态 Active Voice'}
                              </CardTitle>
                            </CardHeader>
                          </Card>
                        </div>
                      )}

                    {analysis.sentenceAnatomy?.constituents &&
                      analysis.sentenceAnatomy.constituents.length > 0 && (
                        <Card className="border-border/70 shadow-2xs">
                          <CardHeader className="pb-3">
                            <div className="flex items-center gap-1.5">
                              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                              <CardTitle className="text-sm font-semibold">
                                句子组成成分拆解 · Sentence Constituents
                              </CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            {analysis.sentenceAnatomy.constituents.map((c, idx) => (
                              <div
                                key={idx}
                                className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <Badge variant="secondary" className="text-[10px] font-medium">
                                    {c.role}
                                  </Badge>
                                </div>
                                <p className="mt-2 font-mono text-xs font-semibold text-foreground">
                                  {c.fragment}
                                </p>
                                <p className="mt-1 leading-relaxed text-muted-foreground">
                                  {c.explanation}
                                </p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {analysis.grammar?.map((g, idx) => (
                        <Card key={idx} className="border-border/70 shadow-2xs">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold">{g.label}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {g.explanation}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>

                  {/* Tab 3: 段 (Discourse Logic, Cohesion & Upgraded Paragraph) */}
                  <TabsContent value="discourse" className="mt-4 space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Card className="border-border/70 shadow-2xs">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-1.5">
                            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                            <CardTitle className="text-sm font-semibold">
                              句群逻辑推进 · Discourse Logic
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xs font-medium leading-relaxed text-foreground">
                            {analysis.discourse?.logic || '诉求声明 → 约束条件 → 机制落地'}
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="border-border/70 shadow-2xs">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            <CardTitle className="text-sm font-semibold">
                              中英思维与成段转换 · Cohesion
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {analysis.discourse?.cohesion || analysis.notes}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {analysis.discourse?.upgradedParagraph && (
                      <Card className="border-border/70 shadow-2xs">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <div>
                            <CardTitle className="text-sm font-semibold">
                              成段升格示范 · Production Engineering Paragraph
                            </CardTitle>
                            <CardDescription className="text-xs">
                              将单句指令扩展为标准 RFC / PR / 技术文档段落
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => speak(analysis.discourse?.upgradedParagraph)}
                            >
                              <Volume2 className="h-3 w-3" />
                              Listen
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => copyTranslation(analysis.discourse?.upgradedParagraph)}
                            >
                              <Copy className="h-3 w-3" />
                              Copy
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2.5 pt-2">
                          <p className="text-sm font-medium leading-relaxed text-foreground">
                            {analysis.discourse.upgradedParagraph}
                          </p>
                          {analysis.discourse.upgradedChinese && (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {analysis.discourse.upgradedChinese}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  {/* Tab 4: Practice Examples */}
                  <TabsContent value="examples" className="mt-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {analysis.examples?.map((ex, idx) => (
                        <Card key={idx} className="border-border/70 shadow-2xs">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="text-sm font-medium leading-snug">
                                {ex.english}
                              </CardTitle>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground"
                                onClick={() => speak(ex.english)}
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-xs text-muted-foreground">{ex.chinese}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold">No prompt selected</h2>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Submit a prompt from your coding agent or load a sample lesson to start learning.
                </p>
              </div>
              {status?.demoEnabled && (
                <Button size="sm" className="mt-2 gap-1.5 text-xs" onClick={handleAddSample}>
                  <Plus className="h-3.5 w-3.5" />
                  Load Sample Lesson
                </Button>
              )}
            </div>
          )
        ) : (
          /* Lexicon / Knowledge Base View */
          <div className="mx-auto max-w-4xl space-y-6 px-10 py-10">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Personal Lexicon</h1>
                <p className="text-xs text-muted-foreground">
                  Saved terms and structural patterns from your past coding sessions.
                </p>
              </div>
              <Badge variant="outline">{filteredKnowledge.length} items</Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredKnowledge.map((item) => (
                <Card key={item.id} className="border-border/70 shadow-2xs">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-[10px] font-normal capitalize">
                        {item.category}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {item.encounters}× seen
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <CardTitle className="text-base font-semibold">{item.term}</CardTitle>
                      {item.category === 'vocabulary' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => speak(item.term)}
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs leading-relaxed text-muted-foreground">{item.meaning}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Settings Dialog (shadcn/ui Dialog) */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Preferences</DialogTitle>
            <DialogDescription className="text-xs">
              Configure local prompt capture and analysis model settings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Capture New Prompts</div>
                <div className="text-xs text-muted-foreground">
                  Listen to local agent hooks in the background.
                </div>
              </div>
              <Switch
                checked={!status?.paused}
                onCheckedChange={handleTogglePause}
                aria-label="Capture new prompts"
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Model Engine</div>
                <div className="text-xs text-muted-foreground">
                  {status?.model || 'Demo preview'}
                </div>
              </div>
              <Badge variant={status?.mode === 'live' ? 'default' : 'secondary'}>
                {status?.mode === 'live' ? 'LIVE' : 'DEMO'}
              </Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
