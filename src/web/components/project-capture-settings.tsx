import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Folder, FolderOpen, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface CaptureProject { path: string; agents: string[] }
export interface CapturePolicy { mode: 'all' | 'allowlist'; allowedProjects: string[]; excludedProjects: string[] }
export interface LocalAgent { id: string; name: string; detected: boolean; configured: boolean; configPath: string; detection?: string }
interface LocalProject { path: string; agents: LocalAgent[] }
interface DirectoryListing { path: string; parent: string | null; directories: { name: string; path: string }[] }
const agentDefaults: LocalAgent[] = [
  { id: 'codex', name: 'Codex', configPath: '.codex/hooks.json' },
  { id: 'claude', name: 'Claude Code', configPath: '.claude/settings.json' },
  { id: 'cursor', name: 'Cursor', configPath: '.cursor/hooks.json' },
  { id: 'grok', name: 'Grok Build', configPath: '.grok/hooks/english-sidecar.json' },
].map(agent => ({ ...agent, detected: false, configured: false }));

async function localRequest<T>(route: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(route, body === undefined ? { signal } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '无法读取本地目录，请检查访问权限。');
  return result;
}

export function ProjectAgentRow({ project, info, disabled, onChange, onRemove }: {
  project: CaptureProject; info?: LocalProject; disabled: boolean;
  onChange: (agents: string[]) => void; onRemove: () => void;
}) {
  const agents = info?.agents || agentDefaults;
  return <section className="min-w-0 border-b border-border pb-4 last:border-b-0 last:pb-0" aria-label={`项目 ${project.path}`}>
    <div className="mb-2 flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2">
        <FolderOpen aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{project.path.split(/[\\/]/).filter(Boolean).pop() || project.path}</p>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
        </div>
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" disabled={disabled} onClick={onRemove} aria-label={`移除项目 ${project.path}`}><X aria-hidden="true" /></Button>
    </div>
    <fieldset disabled={disabled} className="min-w-0 space-y-1">
      <legend className="mb-1 text-xs text-muted-foreground">选择此项目使用的 Agent（可多选）</legend>
      {agents.map(agent => <label key={agent.id} className="flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring/40">
        <input type="checkbox" checked={project.agents.includes(agent.id)} onChange={e => onChange(e.target.checked ? [...project.agents, agent.id] : project.agents.filter(id => id !== agent.id))} className="mt-1 size-4 shrink-0 accent-primary" aria-label={`${project.path} 的 ${agent.name}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium">{agent.name}</span>
            {info && <span className="text-muted-foreground">{agent.configured ? '已接入' : agent.detected ? (agent.detection === 'project' ? '项目中已发现' : '本机已发现') : '未检测到，可手动选择'}</span>}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{agent.configPath.startsWith(project.path + '/') ? agent.configPath.slice(project.path.length + 1) : agent.configPath}</span>
        </span>
      </label>)}
      {project.agents.length === 0 && <p className="text-xs text-destructive">请至少选择一个 Agent，或移除此项目。</p>}
    </fieldset>
  </section>;
}

export function ProjectCaptureSettings({ projects, policy, disabled, onProjectsChange, onPolicyChange, onPendingChange }: {
  projects: CaptureProject[]; policy: CapturePolicy; disabled: boolean;
  onProjectsChange: (projects: CaptureProject[]) => void; onPolicyChange: (policy: CapturePolicy) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [browser, setBrowser] = useState<'project' | 'exclude' | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<Record<string, LocalProject>>({});
  const [filter, setFilter] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  useEffect(() => { onPendingChange(loading); }, [loading, onPendingChange]);
  useEffect(() => () => { requestRef.current?.abort(); onPendingChange(false); }, [onPendingChange]);
  const projectPaths = JSON.stringify(projects.map(project => project.path));
  useEffect(() => {
    const controller = new AbortController();
    for (const project of projectsRef.current) {
      void localRequest<LocalProject>('/api/local/project', controller.signal, { path: project.path }).then(result => {
        if (!controller.signal.aborted) setInfo(current => ({ ...current, [project.path]: result }));
      }).catch(() => { /* Saved projects remain editable even if the directory is offline. Save validates again. */ });
    }
    return () => controller.abort();
  }, [projectPaths]);

  const browse = async (path?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setError(null);
    try {
      const result = await localRequest<DirectoryListing>('/api/local/directories' + (path ? `?path=${encodeURIComponent(path)}` : ''), controller.signal);
      if (controller.signal.aborted) return;
      setListing(result); setPathInput(result.path); setFilter('');
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '读取目录失败。');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const openBrowser = (mode: 'project' | 'exclude') => {
    setBrowser(mode); setListing(null); setPathInput(''); setFilter('');
    void browse();
  };
  const closeBrowser = () => {
    requestRef.current?.abort(); setLoading(false); setBrowser(null); setError(null);
  };
  const selectDirectory = async () => {
    if (!listing || loading) return;
    if (browser === 'exclude') {
      onPolicyChange({ ...policy, excludedProjects: [...new Set([...policy.excludedProjects, listing.path])] });
      closeBrowser(); return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setError(null);
    try {
      const result = await localRequest<LocalProject>('/api/local/project', controller.signal, { path: listing.path });
      if (controller.signal.aborted) return;
      if (projects.some(project => project.path === result.path)) throw new Error('此项目已添加，请在下方选择 Agent。');
      onProjectsChange([...projects, { path: result.path, agents: result.agents.filter(agent => agent.detected).map(agent => agent.id) }]);
      setInfo(current => ({ ...current, [result.path]: result }));
      onPolicyChange({ ...policy, mode: 'allowlist', allowedProjects: [...new Set([...policy.allowedProjects, result.path])] });
      setBrowser(null);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '检测 Agent 失败。');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const removeProject = (path: string) => {
    onProjectsChange(projects.filter(project => project.path !== path));
    onPolicyChange({ ...policy, allowedProjects: policy.allowedProjects.filter(value => value !== path) });
  };
  const legacyPaths = policy.allowedProjects.filter(path => !projects.some(project => project.path === path));
  const locked = disabled || loading;
  return <div className="min-w-0 space-y-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-medium">项目与 Agent</h3><p className="mt-1 text-muted-foreground">选择本地项目，在项目内自动配置采集 Hook。</p></div>
      <Button type="button" variant="outline" size="sm" disabled={locked || !!browser} onClick={() => openBrowser('project')}><Plus aria-hidden="true" />添加项目</Button>
    </div>
    {browser && <section aria-label={browser === 'project' ? '选择项目目录' : '选择排除目录'} aria-busy={loading} className="min-w-0 space-y-3 rounded-lg border border-input bg-muted/25 p-3">
      <div className="flex items-center justify-between gap-2"><h4 className="font-medium">{browser === 'project' ? '选择项目目录' : '选择排除目录'}</h4><Button type="button" variant="ghost" size="icon" className="size-7" disabled={disabled} onClick={closeBrowser} aria-label="关闭目录浏览器"><X aria-hidden="true" /></Button></div>
      <p className="text-muted-foreground">浏览 Sidecar 所在电脑的目录，不会上传目录或文件。</p>
      <div className="flex gap-2">
        <Input aria-label="本地目录路径" aria-describedby={error ? 'local-directory-error' : undefined} value={pathInput} disabled={locked} placeholder="输入绝对路径，或浏览下方文件夹" onChange={e => setPathInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (pathInput.trim()) void browse(pathInput.trim()); } }} className="min-w-0 text-xs" />
        <Button type="button" variant="outline" size="sm" className="h-9" disabled={locked || !pathInput.trim()} onClick={() => void browse(pathInput.trim())}>前往</Button>
      </div>
      {listing && <>
        <div className="flex items-center justify-between gap-2"><p className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{listing.path}</p><Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={locked || !listing.parent} onClick={() => void browse(listing.parent!)}><ArrowUp aria-hidden="true" />上一级</Button></div>
        <Input aria-label="筛选当前目录的文件夹" value={filter} onChange={e => setFilter(e.target.value)} disabled={locked} placeholder="筛选文件夹…" className="h-8 text-xs" />
        <ul className="max-h-44 overflow-y-auto rounded-md border bg-background p-1" aria-label="子目录">
          {listing.directories.filter(directory => directory.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(directory => <li key={directory.path}><button type="button" disabled={locked} onClick={() => void browse(directory.path)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{directory.name}</span><ChevronRight aria-hidden="true" className="size-3 shrink-0" /></button></li>)}
          {!listing.directories.some(directory => directory.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) && <li className="px-2 py-4 text-muted-foreground">{filter ? '没有匹配的文件夹。' : '没有子目录，可直接选择当前目录。'}</li>}
        </ul>
      </>}
      {loading && <p role="status" className="text-muted-foreground">正在读取本地目录与 Agent…</p>}
      {error && <p id="local-directory-error" role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {!listing && !loading && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => void browse()}><RefreshCw aria-hidden="true" />重试</Button>}
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={closeBrowser}>取消选择</Button>
        <Button type="button" size="sm" disabled={locked || !listing} onClick={() => void selectDirectory()}>选择当前目录</Button>
      </div>
    </section>}
    {projects.length > 0 ? <div className="space-y-4">{projects.map(project => <ProjectAgentRow key={project.path} project={project} info={info[project.path]} disabled={locked} onChange={agents => onProjectsChange(projects.map(current => current.path === project.path ? { ...current, agents } : current))} onRemove={() => removeProject(project.path)} />)}</div> : !browser && <div className="border-y border-dashed py-5"><p className="font-medium">还没有添加项目</p><p className="mt-1 text-muted-foreground">添加项目目录，再勾选使用的 Agent；无需手动编辑配置文件。</p></div>}
    <p className="text-muted-foreground">点击底部「确定」后才写入所选 Agent 的配置；已有设置会保留，修改前自动备份。Agent 可能需要重新加载或确认信任 Hook。</p>
    {projects.length > 0 && <p className="text-muted-foreground">移除项目不会删除已安装的 Hook；「仅所选项目」模式下，该目录将不再采集（其他已选父目录覆盖时除外）。</p>}
    <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">高级采集范围{policy.mode === 'all' ? ' · 所有项目' : ' · 仅所选项目'}</summary>
      <div className="mt-3 space-y-3">
        <label htmlFor="capture-policy" className="block font-medium">接收哪些项目的提示</label>
        <Select id="capture-policy" value={policy.mode} disabled={locked} onValueChange={mode => onPolicyChange({ ...policy, mode: mode as CapturePolicy['mode'] })} options={[
          { value: 'allowlist', label: '仅所选项目', description: '只接收所选目录及其子目录中的提示' },
          { value: 'all', label: '所有已配置 Hook 的项目', description: '不限制项目目录，排除目录仍然生效' },
        ]} />
        <p className="text-muted-foreground">添加项目时会切换为「仅所选项目」。排除目录始终优先；此处不会为未勾选的 Agent 安装配置。</p>
        {legacyPaths.length > 0 && <div className="space-y-1"><p className="font-medium">原有允许目录（尚未在此管理 Agent）</p>{legacyPaths.map(path => <div key={path} className="flex items-start justify-between gap-2"><span className="min-w-0 py-1 text-muted-foreground [overflow-wrap:anywhere]">{path}</span><Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" disabled={locked} onClick={() => onPolicyChange({ ...policy, allowedProjects: policy.allowedProjects.filter(value => value !== path) })} aria-label={`移除允许目录 ${path}`}><X aria-hidden="true" /></Button></div>)}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">排除目录</p><Button type="button" size="sm" variant="ghost" disabled={locked || !!browser} onClick={() => openBrowser('exclude')}><Plus aria-hidden="true" />选择目录</Button></div>
        {policy.excludedProjects.length === 0 ? <p className="text-muted-foreground">暂无排除目录。</p> : <ul className="space-y-1">{policy.excludedProjects.map(path => <li key={path} className="flex items-start justify-between gap-2"><span className="min-w-0 py-1 text-muted-foreground [overflow-wrap:anywhere]">{path}</span><Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" disabled={locked} onClick={() => onPolicyChange({ ...policy, excludedProjects: policy.excludedProjects.filter(value => value !== path) })} aria-label={`移除排除目录 ${path}`}><X aria-hidden="true" /></Button></li>)}</ul>}
      </div>
    </details>
  </div>;
}
