import { createPlaybackSession, requireOk, selectMatchingEvent, stageSettingsModel, removeSettingsModel, type SettingsModelDraft } from './lib/reliability.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Edit2,
  CheckCircle2,
  Radio,
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
import { TaskStatusBadge, type TaskStatus } from '@/components/task-status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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

import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from '@/components/ui/alert-dialog';

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
  kind?: string;
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
  status: TaskStatus;
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

interface SafeModel {
  id: string;
  name: string;
  kind: 'text' | 'speech';
  baseUrl: string;
  model: string;
  voice?: string;
  temperature?: number | null;
  apiKeySet: boolean;
  apiKeyMasked: string;
}

interface SidecarStatus {
  mode: 'live' | 'unconfigured';
  capturePolicy: { mode: 'all' | 'allowlist'; allowedProjects: string[]; excludedProjects: string[] };
  model: string;
  paused: boolean;
  activeTextModel?: SafeModel | null;
  activeSpeechModel?: SafeModel | null;
  stats: {
    total: number;
    complete: number;
    pending: number;
    failed: number;
    knowledge: number;
    sources: { source: string; count: number }[];
  };
}

interface ModelFormData {
  id?: string;
  name: string;
  kind: 'text' | 'speech';
  baseUrl: string;
  model: string;
  voice?: string;
  temperature?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

const AGENT_NAMES: Record<string, string> = {
  codex: 'Codex',
  cursor: 'Cursor',
  claude: 'Claude Code',
  qoder: 'Qoder',
  pi: 'Pi',
  dsh: 'DSH',
  grok: 'Grok Build',
  manual: '手动导入',
};

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
  const [models, setModels] = useState<SafeModel[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainMode, setMainMode] = useState<'feed' | 'knowledge'>('feed');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const playbackRef = useRef<ReturnType<typeof createPlaybackSession> | null>(null);
  if (!playbackRef.current) playbackRef.current = createPlaybackSession({
    cancelSpeech: () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); },
    onStop: () => { setSpeakingText(null); },
  });
  const mutationLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [purgeKnowledge, setPurgeKnowledge] = useState(false);
  const [modelDeleteTarget, setModelDeleteTarget] = useState<string | null>(null);
  const [captureDraft, setCaptureDraft] = useState<SidecarStatus['capturePolicy'] | null>(null);
  const [pausedDraft, setPausedDraft] = useState(false);
  const [modelDraft, setModelDraft] = useState<SettingsModelDraft>({ models: [], activeTextId: null, activeSpeechId: null });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'text' | 'speech'>('text');
  const [editingModel, setEditingModel] = useState<ModelFormData | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
      const [sRes, eRes, kRes, mRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/events?limit=120'),
        fetch('/api/knowledge'),
        fetch('/api/models'),
      ]);
      if (!sRes.ok || !eRes.ok || !kRes.ok) return;
      const sData: SidecarStatus = await sRes.json();
      const eData: { events: SidecarEvent[] } = await eRes.json();
      const kData: { knowledge: KnowledgeItem[] } = await kRes.json();

      if (mRes.ok) {
        const mData: { activeTextId: string | null; activeSpeechId: string | null; models: SafeModel[] } =
          await mRes.json();
        setModels(mData.models || []);
        setActiveTextId(mData.activeTextId);
        setActiveSpeechId(mData.activeSpeechId);
      }

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

  const activeTextModel = useMemo(() => {
    return models.find((m) => m.id === activeTextId && m.kind === 'text') || status?.activeTextModel || null;
  }, [models, activeTextId, status]);

  const activeSpeechModel = useMemo(() => {
    return models.find((m) => m.id === activeSpeechId && m.kind === 'speech') || status?.activeSpeechModel || null;
  }, [models, activeSpeechId, status]);

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
    () => selectMatchingEvent(filteredEvents, selectedId),
    [filteredEvents, selectedId],
  );

  useEffect(() => {
    if (mainMode === 'feed' && selectedEvent && selectedEvent.id !== selectedId) setSelectedId(selectedEvent.id);
  }, [mainMode, selectedEvent?.id, selectedId]);

  const stopAudio = () => playbackRef.current?.stop();
  useEffect(() => () => playbackRef.current?.stop(), []);
  useEffect(() => { stopAudio(); setTtsError(null); }, [selectedEvent?.id, mainMode, activeSpeechModel?.id]);

  const speak = async (text?: string) => {
    const clean = text?.replace(/\[Demo preview\]/g, '').trim();
    if (!clean) return;
    const session = playbackRef.current!;
    if (session.text === clean) { session.stop(); return; }
    const ticket = session.begin(clean);
    setTtsError(null);
    setSpeakingText(clean);
    const fallback = (voiceTicket = ticket) => {
      if (!voiceTicket.current()) return;
      if (!('speechSynthesis' in window)) {
        session.stop();
        setTtsError('浏览器不支持语音播放，请配置 TTS 模型。');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.onend = () => { if (voiceTicket.current()) session.stop(); };
      utterance.onerror = () => {
        if (voiceTicket.current()) { session.stop(); setTtsError('浏览器语音播放失败，请重试。'); }
      };
      try { window.speechSynthesis.speak(utterance); }
      catch { if (voiceTicket.current()) { session.stop(); setTtsError('浏览器语音播放失败，请重试。'); } }
    };
    if (!activeSpeechModel) { fallback(); return; }
    try {
      const res = await requireOk(await fetch('/api/tts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: clean }), signal: ticket.signal,
      }));
      const blob = await res.blob();
      if (!ticket.current()) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      if (!session.attach(ticket, audio, url, (value: string) => URL.revokeObjectURL(value))) return;
      audio.onended = () => { if (ticket.current()) session.stop(); };
      audio.onerror = () => {
        if (!ticket.current()) return;
        session.stop();
        setTtsError('音频播放失败，请重试或检查 TTS 配置。');
      };
      await audio.play();
    } catch (err) {
      if (!ticket.current()) return;
      // Release any Blob URL/audio before starting a browser-voice fallback.
      session.stop();
      setTtsError('TTS 不可用，已尝试浏览器语音。');
      const fallbackTicket = session.begin(clean);
      setSpeakingText(clean);
      fallback(fallbackTicket);
    }
  };

  const copyTranslation = async (text?: string) => {
    if (!text) return;
    const clean = text.replace(/\[Demo preview\]/g, '').trim();
    try {
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setMutationError('复制失败，请检查浏览器剪贴板权限。'); }
  };

  const mutate = async (operation: () => Promise<void>, modelForm = false) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setMutationError(null);
    if (modelForm) setFormError(null);
    try { await operation(); }
    catch (err) {
      const message = err instanceof Error ? err.message : '操作失败，请重试。';
      if (modelForm) setFormError(message);
      else setMutationError(message);
    } finally { mutationLock.current = false; setBusy(false); }
  };
  const request = async (url: string, method: string, body?: unknown) => requireOk(await fetch(url, {
    method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const handleDelete = (id: string) => mutate(async () => {
    await request(`/api/events/${encodeURIComponent(id)}${purgeKnowledge ? '?knowledge=purge' : ''}`, 'DELETE');
    setDeleteTarget(null);
    setSelectedId(null);
    await refreshData();
  });
  const handleEventAction = (id: string, action: 'retry' | 'cancel') => mutate(async () => {
    await request(`/api/events/${encodeURIComponent(id)}/${action}`, 'POST');
    await refreshData();
  });
  const closeSettings = () => {
    if (mutationLock.current) return;
    setSettingsOpen(false);
    setCaptureDraft(null);
    setModelDraft({ models: [], activeTextId: null, activeSpeechId: null });
    setEditingModel(null);
    setModelDeleteTarget(null);
    setFormError(null);
    setMutationError(null);
  };
  const handleSaveSettings = () => mutate(async () => {
    if (!captureDraft) return;
    const nextModels = editingModel ? stageSettingsModel(modelDraft, editingModel) : modelDraft;
    setModelDraft(nextModels);
    if (editingModel) setEditingModel(null);
    // The only request made by this dialog: save all changes together.
    await request('/api/settings', 'POST', {
      paused: pausedDraft,
      capturePolicy: { ...captureDraft, allowedProjects: captureDraft.allowedProjects.map(p => p.trim()).filter(Boolean), excludedProjects: captureDraft.excludedProjects.map(p => p.trim()).filter(Boolean) },
      modelDraft: nextModels,
    });
    setSettingsOpen(false);
    setEditingModel(null);
    setCaptureDraft(null);
    setModelDraft({ models: [], activeTextId: null, activeSpeechId: null });
    await refreshData();
  });
  const handleSetActiveModel = (id: string) => {
    const model = modelDraft.models.find(m => m.id === id);
    if (busy || !model) return;
    setModelDraft({ ...modelDraft, [model.kind === 'text' ? 'activeTextId' : 'activeSpeechId']: id });
  };
  const handleDeleteModel = (id: string) => {
    if (busy) return;
    setModelDraft(removeSettingsModel(modelDraft, id));
    if (editingModel?.id === id) setEditingModel(null);
    setModelDeleteTarget(null);
  };

  const handleOpenNewModel = (kind: 'text' | 'speech') => {
    setFormError(null);
    setEditingModel({
      name: '',
      kind,
      baseUrl: 'https://api.openai.com/v1',
      model: kind === 'text' ? 'gpt-4o-mini' : 'tts-1',
      voice: kind === 'speech' ? 'marin' : undefined,
      temperature: kind === 'text' ? '' : undefined,
      apiKey: '',
    });
  };

  const handleOpenEditModel = (m: SafeModel) => {
    setFormError(null);
    setEditingModel({
      id: m.id,
      name: m.name,
      kind: m.kind,
      baseUrl: m.baseUrl,
      model: m.model,
      voice: m.voice || 'marin',
      temperature: m.temperature !== null && m.temperature !== undefined ? String(m.temperature) : '',
      apiKey: '',
    });
  };

  const handleSaveModel = () => {
    if (busy) return false;
    if (!editingModel) return true;
    try {
      setModelDraft(stageSettingsModel(modelDraft, editingModel));
      setEditingModel(null);
      setFormError(null);
      return true;
    } catch (error) { setFormError(error instanceof Error ? error.message : '请检查模型配置。'); return false; }
  };

  const openSettings = () => {
    if (busy) return;
    setSettingsTab('text');
    setEditingModel(null);
    setFormError(null);
    setCaptureDraft(structuredClone(status?.capturePolicy || { mode: 'all', allowedProjects: [], excludedProjects: [] }));
    setPausedDraft(status?.paused || false);
    setModelDraft({ models: models.map(m => ({ ...m })), activeTextId, activeSpeechId });
    setMutationError(null);
    setSettingsOpen(true);
  };

  const needsModelSetup = status?.mode === 'unconfigured';
  const analysis = selectedEvent?.analysis;
  const cleanHeroEnglish = analysis?.translation?.replace(/\s*\[Demo preview\]\s*/g, '') || '';

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background text-foreground">
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
              {status?.mode === 'live' ? 'Live' : '未配置'}
            </Badge>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme" title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              disabled={busy} onClick={openSettings}
              aria-label="Settings" title="Settings"
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
              aria-label={mainMode === 'feed' ? '搜索提示' : '搜索词汇'}
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
                  {search.trim() ? '没有匹配的提示，请尝试其他关键词。' : needsModelSetup
                    ? '先接入文本模型。采集的提示会保留在队列中，接入后自动处理。'
                    : '暂无提示。从编码助手提交提示后会自动出现在这里。'}
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
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                        <TaskStatusBadge status={item.status} />
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
        </div>
      </aside>

      {/* Main Content Area: Breathable, Centered, Progressive Disclosure */}
      <main className="flex-1 overflow-y-auto bg-muted/10">
        {needsModelSetup && (
          <div role="status" className="mx-10 mt-4 flex items-center justify-between gap-4 rounded-md border bg-muted/50 p-3 text-xs">
            <div className="space-y-1">
              <p className="font-medium">先接入文本模型，开始生成学习内容</p>
              <p className="text-muted-foreground">当前没有可用的文本模型密钥，不会生成内容。已采集的提示会保持排队，接入并启用带有 API Key 的文本模型后自动处理。</p>
            </div>
            <Button size="sm" className="shrink-0 text-xs" disabled={busy} onClick={openSettings}>接入模型</Button>
          </div>
        )}
        {mutationError && <div role="alert" className="mx-10 mt-4 rounded-md bg-destructive/15 p-3 text-xs text-destructive">{mutationError}</div>}
        {mainMode === 'feed' ? (
          selectedEvent ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-6 px-10 py-10">
              {/* 1. Primary Hero Card: The English Expression */}
              <Card className="border-border/80 shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <TaskStatusBadge status={selectedEvent.status} />
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
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => speak(cleanHeroEnglish)}
                          >
                            {speakingText === cleanHeroEnglish ? (
                              <VolumeX className="h-3.5 w-3.5 text-destructive" />
                            ) : (
                              <Volume2 className="h-3.5 w-3.5" />
                            )}
                            {speakingText === cleanHeroEnglish ? 'Stop' : 'Listen'}
                          </Button>
                          <Badge
                            variant="outline"
                            className="h-8 px-2 text-[11px] font-normal text-muted-foreground border-dashed"
                            title={
                              activeSpeechModel
                                ? `TTS Model: ${activeSpeechModel.name} (${activeSpeechModel.model}) · Voice: ${activeSpeechModel.voice || 'marin'}`
                                : 'Web Speech API (Browser default)'
                            }
                          >
                            {activeSpeechModel ? activeSpeechModel.name : 'Browser voice'}
                          </Badge>
                          {ttsError && (
                            <span role="status" className="text-[11px] font-medium text-destructive animate-in fade-in duration-200">
                              {ttsError}
                            </span>
                          )}
                        </div>

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
                    {['failed', 'cancelled'].includes(selectedEvent.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        disabled={busy}
                        onClick={() => handleEventAction(selectedEvent.id, 'retry')}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                    {['pending', 'processing'].includes(selectedEvent.status) && (
                      <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy}
                        onClick={() => handleEventAction(selectedEvent.id, 'cancel')}>取消分析</Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      onClick={() => { setDeleteTarget(selectedEvent.id); setPurgeKnowledge(false); }}
                      aria-label="Delete prompt" title="Delete prompt"
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
                      {needsModelSetup && selectedEvent.status === 'pending'
                        ? '等待接入模型：此提示已加入队列。请先接入并启用带有 API Key 的文本模型，之后会自动处理；缺少密钥时不会生成内容。'
                        : selectedEvent.error || (selectedEvent.status === 'cancelled' ? '分析已取消，可点击 Retry 重试。' : selectedEvent.status === 'skipped' ? '此提示未分析。' : selectedEvent.status === 'failed' ? '分析失败，请重试。' : selectedEvent.status === 'pending' ? '提示已排队，将在后台自动处理。' : 'Analyzing prompt in the background...')}
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
                  {analysis?.corrections?.map((correction, index) => (
                    <div key={index} className="rounded-lg bg-muted/50 px-4 py-3 text-xs">
                      <p className="mb-2 font-medium">{correction.kind === 'style' ? '风格优化（不表示原句有错）' : correction.kind === 'correction' ? '语言纠错' : '纠错 / 风格建议（未分类）'}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">{correction.before}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium text-foreground">{correction.after}</span>
                      </div>
                      {correction.reason && <p className="mt-1.5 leading-relaxed text-muted-foreground">{correction.reason}</p>}
                    </div>
                  ))}
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
                                aria-label={`Pronounce ${v.term}`} title={`Pronounce ${v.term}`}
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
                    {(
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <Card className="border-border/70 shadow-2xs">
                            <CardHeader className="pb-1.5 pt-3.5">
                              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider">
                                句子结构 · Pattern
                              </CardDescription>
                              <CardTitle className="text-xs font-semibold leading-snug">
                                {analysis.sentenceAnatomy?.pattern || '暂无分析'}
                              </CardTitle>
                            </CardHeader>
                          </Card>

                          <Card className="border-border/70 shadow-2xs">
                            <CardHeader className="pb-1.5 pt-3.5">
                              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider">
                                时态解析 · Tense
                              </CardDescription>
                              <CardTitle className="text-xs font-semibold leading-snug">
                                {analysis.sentenceAnatomy?.tense || '暂无分析'}
                              </CardTitle>
                            </CardHeader>
                          </Card>

                          <Card className="border-border/70 shadow-2xs">
                            <CardHeader className="pb-1.5 pt-3.5">
                              <CardDescription className="text-[10px] font-semibold uppercase tracking-wider">
                                语态解析 · Voice
                              </CardDescription>
                              <CardTitle className="text-xs font-semibold leading-snug">
                                {analysis.sentenceAnatomy?.voice || '暂无分析'}
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
                            {analysis.discourse?.logic || '暂无分析'}
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
                            {analysis.discourse?.cohesion || '暂无分析'}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {analysis.discourse?.upgradedParagraph && (
                      <Card className="border-border/70 shadow-2xs">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <div>
                            <CardTitle className="text-sm font-semibold">
                              扩展练习 · Extended Paragraph
                            </CardTitle>
                            <CardDescription className="text-xs">
                              扩展为 RFC / PR / 技术文档段落，可能引入额外设定；不是原文翻译。
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
                                aria-label={`朗读例句 ${ex.english}`}
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
                <h2 className="text-base font-semibold">{needsModelSetup ? '先接入文本模型' : search.trim() ? '没有匹配的提示' : '还没有提示'}</h2>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {needsModelSetup
                    ? '接入并启用带有 API Key 的文本模型后，即可生成学习内容。已采集的提示会保留在队列中，接入后自动处理。'
                    : search.trim() ? '请尝试其他关键词，或清空搜索查看历史提示。' : '从编码助手提交提示，系统会在后台自动生成学习内容。'}
                </p>
              </div>
              {needsModelSetup && (
                <Button size="sm" className="mt-2 gap-1.5 text-xs" disabled={busy} onClick={openSettings}>
                  接入模型
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
                          aria-label={`朗读 ${item.term}`}
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!busy && !open) setDeleteTarget(null); }}>
        <AlertDialogContent aria-busy={busy}>
          <AlertDialogTitle className="text-base font-semibold text-balance">删除提示卡片？</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground text-pretty">默认只删除此卡片，保留已积累的词汇与语法。此操作不可撤销。</AlertDialogDescription>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={purgeKnowledge} disabled={busy} onChange={(e) => setPurgeKnowledge(e.target.checked)} />同时删除此提示关联的派生知识（其他提示共享或此前明确保留的知识仍会保留）</label>
          {mutationError && <p role="alert" className="text-xs text-destructive">{mutationError}</p>}
          <div className="flex justify-end gap-2"><AlertDialogCancel asChild><Button variant="outline" disabled={busy}>取消</Button></AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => deleteTarget && handleDelete(deleteTarget)}>{busy ? '删除中…' : purgeKnowledge ? '删除卡片及关联知识' : '只删除卡片'}</Button></div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!modelDeleteTarget} onOpenChange={(open) => { if (!busy && !open) setModelDeleteTarget(null); }}>
        <AlertDialogContent aria-busy={busy}>
          <AlertDialogTitle className="text-base font-semibold text-balance">移除此模型配置？</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground text-pretty">将此模型从设置草稿中移除。只有点击设置底部「确定」才会删除配置与密钥，点击「取消」可保留原配置。</AlertDialogDescription>
          {mutationError && <p role="alert" className="text-xs text-destructive">{mutationError}</p>}
          <div className="flex justify-end gap-2"><AlertDialogCancel asChild><Button variant="outline" disabled={busy}>取消</Button></AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => modelDeleteTarget && handleDeleteModel(modelDeleteTarget)}>移出草稿</Button></div>
        </AlertDialogContent>
      </AlertDialog>
      {/* Settings Dialog: Enhanced with Multi-Model Configuration */}
      <Dialog open={settingsOpen} onOpenChange={(open) => { if (!open) closeSettings(); }}>
        <DialogContent
          onPointerDownOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-sidecar-select-content]')) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-sidecar-select-content]')) event.preventDefault();
          }}
          aria-busy={busy} className="sm:max-w-xl max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Preferences</DialogTitle>
            <DialogDescription className="text-xs">
              配置采集范围、文本模型与语音模型。所有修改在点击底部「确定」后生效。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-5 overflow-y-auto py-2 pr-1">
            {/* Capture Toggle */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Capture New Prompts</div>
                <div className="text-xs text-muted-foreground">
                  Listen to local coding agent hooks in the background.
                </div>
              </div>
              <Switch
                disabled={busy || !status}
                checked={!pausedDraft}
                onCheckedChange={(checked) => setPausedDraft(!checked)}
                aria-label="Capture new prompts"
              />
            </div>

            <Separator />

            <div className="space-y-3 text-xs">
              {captureDraft && <>
                <label htmlFor="capture-policy" className="block font-medium">项目采集范围</label>
                <Select
                  id="capture-policy"
                  aria-describedby="project-path-hint"
                  value={captureDraft.mode}
                  disabled={busy}
                  onValueChange={(mode) => setCaptureDraft({ ...captureDraft, mode: mode as 'all' | 'allowlist' })}
                  options={[
                    { value: 'all', label: '所有项目', description: '自动采集，排除名单中的目录除外' },
                    { value: 'allowlist', label: '仅允许名单', description: '只采集“允许的项目目录”中的内容' },
                  ]}
                />
                <p id="project-path-hint" className="text-muted-foreground">项目须填写本地绝对目录，每行一个。排除名单优先；仅允许名单模式会拒绝未知项目。</p>
                <label htmlFor="allowed-projects" className="block font-medium">允许的项目目录</label>
                <textarea id="allowed-projects" aria-describedby="project-path-hint" rows={3} disabled={busy} value={captureDraft.allowedProjects.join('\n')} onChange={(e) => setCaptureDraft({ ...captureDraft, allowedProjects: e.target.value.split('\n') })} className="w-full rounded-md border bg-background p-2 font-mono" />
                <label htmlFor="excluded-projects" className="block font-medium">排除的项目目录</label>
                <textarea id="excluded-projects" aria-describedby="project-path-hint" rows={3} disabled={busy} value={captureDraft.excludedProjects.join('\n')} onChange={(e) => setCaptureDraft({ ...captureDraft, excludedProjects: e.target.value.split('\n') })} className="w-full rounded-md border bg-background p-2 font-mono" />
              </>}
            </div>
            <Separator />
            {/* Model Engine Display */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Model Engine</div>
                <div className="text-xs text-muted-foreground">
                  {activeTextModel ? `${activeTextModel.name} (${activeTextModel.model})` : '尚未接入文本模型'}
                </div>
              </div>
              <Badge variant={status?.mode === 'live' ? 'default' : 'secondary'}>
                {status?.mode === 'live' ? 'LIVE' : '未配置'}
              </Badge>
            </div>

            <Separator />

            {/* Multi-Model Configurations */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Model Configurations</div>
              </div>
              <p className="text-xs text-muted-foreground">学习内容仅由已启用的真实文本模型生成。未配置 API Key 时不会生成内容，提示会保持排队；补充密钥并启用模型后自动处理。</p>

              <Tabs
                value={settingsTab}
                onValueChange={(v) => {
                  if (!handleSaveModel()) return;
                  setSettingsTab(v as 'text' | 'speech');
                  setEditingModel(null);
                  setFormError(null);
                }}
                className="w-full"
              >
                <div className="flex items-center justify-between pb-2">
                  <TabsList className="grid h-8 grid-cols-2 w-48">
                    <TabsTrigger value="text" className="text-xs">
                      Text Models ({modelDraft.models.filter((m) => m.kind === 'text').length})
                    </TabsTrigger>
                    <TabsTrigger value="speech" className="text-xs">
                      TTS Models ({modelDraft.models.filter((m) => m.kind === 'speech').length})
                    </TabsTrigger>
                  </TabsList>

                  {!editingModel && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2.5 text-xs"
                      disabled={busy} onClick={() => handleOpenNewModel(settingsTab)}
                    >
                      <Plus className="h-3 w-3" />
                      Add {settingsTab === 'text' ? 'Text' : 'TTS'} Model
                    </Button>
                  )}
                </div>

                {/* Inline Model Edit/Add Form */}
                {editingModel && (
                  <div className="my-3 rounded-lg border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">
                        {editingModel.id ? 'Edit Model' : `New ${editingModel.kind.toUpperCase()} Model`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs text-muted-foreground"
                        disabled={busy} onClick={() => setEditingModel(null)}
                      >
                        Cancel
                      </Button>
                    </div>

                    {formError && (
                      <div id="model-form-error" role="alert" className="rounded-md bg-destructive/15 p-2 text-xs text-destructive">
                        {formError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                      <div className="space-y-1">
                        <label htmlFor="model-name" className="font-medium text-muted-foreground">Display Name</label>
                        <Input disabled={busy} id="model-name" aria-invalid={!!formError} aria-describedby={formError ? 'model-form-error' : undefined}
                          value={editingModel.name}
                          onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                          placeholder={editingModel.kind === 'text' ? 'e.g. OpenAI GPT-4o' : 'e.g. OpenAI Voice'}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="model-id" className="font-medium text-muted-foreground">Model Identifier</label>
                        <Input disabled={busy} id="model-id" aria-invalid={!!formError} aria-describedby={formError ? 'model-form-error' : undefined}
                          value={editingModel.model}
                          onChange={(e) => setEditingModel({ ...editingModel, model: e.target.value })}
                          placeholder={editingModel.kind === 'text' ? 'e.g. gpt-6-luna' : 'e.g. tts-1'}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1 sm:col-span-2">
                        <label htmlFor="model-base-url" className="font-medium text-muted-foreground">Base URL</label>
                        <Input disabled={busy} id="model-base-url" aria-invalid={!!formError} aria-describedby={formError ? 'model-form-error' : undefined}
                          value={editingModel.baseUrl}
                          onChange={(e) => setEditingModel({ ...editingModel, baseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                          className="h-8 text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Remote endpoints must use HTTPS. Local loopback allows HTTP.
                        </span>
                      </div>

                      <div className="space-y-1 sm:col-span-2">
                        <label htmlFor="model-api-key" className="font-medium text-muted-foreground">API Key</label>
                        <Input id="model-api-key" aria-invalid={!!formError} aria-describedby={formError ? 'model-form-error' : undefined}
                          type="password"
                          value={editingModel.apiKey || ''}
                          disabled={busy || editingModel.clearApiKey}
                          onChange={(e) => setEditingModel({ ...editingModel, apiKey: e.target.value })}
                          placeholder={
                            editingModel.id
                              ? '留空保留旧密钥；清除请勾选下方控件'
                              : 'sk-...'
                          }
                          className="h-8 text-xs font-mono"
                        />
                        {editingModel.id && <label className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={!!editingModel.clearApiKey} disabled={busy} onChange={(e) => setEditingModel({ ...editingModel, clearApiKey: e.target.checked, apiKey: '' })} />
                          清除已保存密钥（点击底部「确定」后生效）
                        </label>}
                        {editingModel.id && editingModel.baseUrl.trim().replace(/\/+$/, '') !== modelDraft.models.find((m) => m.id === editingModel.id)?.baseUrl.replace(/\/+$/, '') && <p id="provider-key-hint" className="text-xs text-muted-foreground">Provider Base URL 已更改，须重新输入密钥，或明确选择清除密钥。旧密钥不会发送给新 Provider。</p>}
                        <span className="text-[10px] text-muted-foreground">
                          密钥提交后保存在本地受限权限文件中；读取配置只返回掩码，不返回完整密钥。
                        </span>
                      </div>

                      {editingModel.kind === 'speech' ? (
                        <div className="space-y-1">
                          <label htmlFor="model-voice" className="font-medium text-muted-foreground">Voice Name</label>
                          <Input disabled={busy} id="model-voice"
                            value={editingModel.voice || ''}
                            onChange={(e) => setEditingModel({ ...editingModel, voice: e.target.value })}
                            placeholder="marin (or alloy, echo, nova...)"
                            className="h-8 text-xs"
                          />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label htmlFor="model-temperature" className="font-medium text-muted-foreground">Temperature (Optional)</label>
                          <Input disabled={busy} id="model-temperature"
                            type="number"
                            step="0.1"
                            min="0"
                            max="2"
                            value={editingModel.temperature ?? ''}
                            onChange={(e) => setEditingModel({ ...editingModel, temperature: e.target.value })}
                            placeholder="Leave blank for model default (null)"
                            className="h-8 text-xs"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Note: gpt-6-luna rejects custom temperature; leave empty.
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={busy} onClick={() => setEditingModel(null)}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" disabled={busy} className="h-7 text-xs" onClick={handleSaveModel}>
                        完成编辑
                      </Button>
                    </div>
                  </div>
                )}

                {/* Text Models Tab Content */}
                <TabsContent value="text" className="mt-2 space-y-2">
                  {modelDraft.models.filter((m) => m.kind === 'text').length === 0 ? (
                    <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                      尚未配置文本模型。点击 Add Text Model 添加配置并填写 API Key，启用后会自动处理排队中的提示。
                    </div>
                  ) : (
                    modelDraft.models
                      .filter((m) => m.kind === 'text')
                      .map((m) => {
                        const isActive = m.id === modelDraft.activeTextId;
                        return (
                          <div
                            key={m.id}
                            className={`flex items-center justify-between rounded-lg border p-3 text-xs transition-colors ${
                              isActive ? 'border-primary/60 bg-accent/40 shadow-2xs' : 'border-border/70 hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                disabled={busy || isActive}
                                aria-label={`Activate ${m.name}`}
                                onClick={() => handleSetActiveModel(m.id)}
                                className="mt-0.5"
                                title={isActive ? 'Currently active' : 'Click to activate'}
                              >
                                {isActive ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Radio className="h-4 w-4 text-muted-foreground/60 hover:text-foreground" />
                                )}
                              </button>
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-foreground">{m.name}</span>
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {m.model}
                                  </span>
                                  {isActive && (
                                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                                  <span className="truncate max-w-[200px]">{m.baseUrl}</span>
                                  <span>·</span>
                                  <span>{m.apiKeySet ? `Key: ${m.apiKeyMasked}` : '未配置 API Key，不会生成内容'}</span>
                                  {m.temperature !== null && m.temperature !== undefined && (
                                    <>
                                      <span>·</span>
                                      <span>temp: {m.temperature}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                disabled={busy}
                                aria-label={`Edit ${m.name}`}
                                onClick={() => handleOpenEditModel(m)}
                                title="Edit"
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${m.name}`}
                                onClick={() => { setMutationError(null); setModelDeleteTarget(m.id); }}
                                title="Delete"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                  )}
                </TabsContent>

                {/* Speech (TTS) Models Tab Content */}
                <TabsContent value="speech" className="mt-2 space-y-2">
                  {modelDraft.models.filter((m) => m.kind === 'speech').length === 0 ? (
                    <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                      No TTS models configured. Listen uses local Browser voice by default.
                    </div>
                  ) : (
                    modelDraft.models
                      .filter((m) => m.kind === 'speech')
                      .map((m) => {
                        const isActive = m.id === modelDraft.activeSpeechId;
                        return (
                          <div
                            key={m.id}
                            className={`flex items-center justify-between rounded-lg border p-3 text-xs transition-colors ${
                              isActive ? 'border-primary/60 bg-accent/40 shadow-2xs' : 'border-border/70 hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                disabled={busy || isActive}
                                aria-label={`Activate ${m.name}`}
                                onClick={() => handleSetActiveModel(m.id)}
                                className="mt-0.5"
                                title={isActive ? 'Currently active' : 'Click to activate'}
                              >
                                {isActive ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Radio className="h-4 w-4 text-muted-foreground/60 hover:text-foreground" />
                                )}
                              </button>
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-foreground">{m.name}</span>
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {m.model}
                                  </span>
                                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                                    Voice: {m.voice || 'marin'}
                                  </Badge>
                                  {isActive && (
                                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                                  <span className="truncate max-w-[200px]">{m.baseUrl}</span>
                                  <span>·</span>
                                  <span>{m.apiKeySet ? `Key: ${m.apiKeyMasked}` : 'No API key'}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                disabled={busy}
                                aria-label={`Edit ${m.name}`}
                                onClick={() => handleOpenEditModel(m)}
                                title="Edit"
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${m.name}`}
                                onClick={() => { setMutationError(null); setModelDeleteTarget(m.id); }}
                                title="Delete"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <div className="space-y-3 border-t pt-4">
            {mutationError && <p role="alert" className="text-xs text-destructive">{mutationError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={closeSettings}>取消</Button>
              <Button disabled={busy || !captureDraft || !status} onClick={handleSaveSettings}>{busy ? '提交中…' : '确定'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
