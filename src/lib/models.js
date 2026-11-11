import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function validateBaseUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('baseUrl is required');
  }
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new Error('Invalid baseUrl URL format');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('baseUrl must use http: or https:');
  }
  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(rawHost);
  if (parsed.protocol !== 'https:' && !isLoopback) {
    throw new Error('Remote baseUrl must use HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('baseUrl must not contain credentials, query parameters or a fragment');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

export function toSafeModel(model) {
  if (!model || typeof model !== 'object') return null;
  const isSpeech = model.kind === 'speech';
  let safeUrl;
  try { safeUrl = validateBaseUrl(model.baseUrl); } catch { safeUrl = '[Invalid endpoint — edit configuration]'; }
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    baseUrl: safeUrl,
    model: model.model,
    voice: isSpeech ? (model.voice || 'marin') : undefined,
    temperature: !isSpeech ? (typeof model.temperature === 'number' ? model.temperature : null) : undefined,
    apiKeySet: Boolean(model.apiKey && model.apiKey.trim()),
    apiKeyMasked: maskApiKey(model.apiKey),
  };
}

// Select the entire configuration, never individual fallback fields across providers.
export function resolveTextConfig(activeModel, fallback) {
  const selected = activeModel || fallback;
  const apiKey = selected.apiKey?.trim() || '';
  let mode = apiKey ? 'live' : 'unconfigured';
  let baseUrl;
  try { baseUrl = validateBaseUrl(selected.baseUrl); }
  catch { mode = 'unconfigured'; }
  return {
    baseUrl, model: selected.model, apiKey,
    temperature: activeModel ? activeModel.temperature : null,
    mode,
  };
}

export class ModelStore {
  constructor(dataDir, fallbackConfig = {}) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, 'models.json');
    this.fallbackConfig = fallbackConfig;
    this.init();
  }

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.dataDir, 0o700); } catch { /* Windows */ }

    if (!fs.existsSync(this.filePath)) {
      // 首次启动时，用现有 LEARNING_BASE_URL、LEARNING_MODEL、LEARNING_API_KEY 生成一条 text 配置并设为当前项。不自动发明 TTS 配置。
      const defaultId = crypto.randomUUID();
      const defaultTextModel = {
        id: defaultId,
        name: this.fallbackConfig.model || 'Default Text Model',
        kind: 'text',
        baseUrl: validateBaseUrl(this.fallbackConfig.baseUrl || 'https://api.openai.com/v1'),
        model: this.fallbackConfig.model || 'gpt-4o-mini',
        apiKey: this.fallbackConfig.apiKey || '',
        temperature: null,
      };
      const initialData = {
        activeTextId: defaultId,
        activeSpeechId: null,
        models: [defaultTextModel],
      };
      this.save(initialData);
    }
  }

  load() {
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(content);
      return {
        activeTextId: typeof data.activeTextId === 'string' ? data.activeTextId : null,
        activeSpeechId: typeof data.activeSpeechId === 'string' ? data.activeSpeechId : null,
        models: Array.isArray(data.models) ? data.models : [],
      };
    } catch {
      // Fail closed: never silently fall back to another provider/key after corruption.
      throw new Error('Model configuration is unreadable; restore the local configuration before continuing');
    }
  }

  save(data) {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(this.filePath, jsonStr, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows */ }
  }

  list() {
    const data = this.load();
    return {
      activeTextId: data.activeTextId,
      activeSpeechId: data.activeSpeechId,
      models: data.models.map(toSafeModel),
    };
  }

  getActiveTextModel() {
    const data = this.load();
    if (!data.activeTextId) return null;
    return data.models.find(m => m.id === data.activeTextId && m.kind === 'text') || null;
  }

  getActiveSpeechModel() {
    const data = this.load();
    if (!data.activeSpeechId) return null;
    return data.models.find(m => m.id === data.activeSpeechId && m.kind === 'speech') || null;
  }

  addModel(input) {
    if (!input || typeof input !== 'object') throw new Error('Invalid model data');
    if (!input.name || !String(input.name).trim()) throw new Error('Model name is required');
    if (!['text', 'speech'].includes(input.kind)) throw new Error('Model kind must be text or speech');
    if (!input.model || !String(input.model).trim()) throw new Error('Model identifier is required');
    const baseUrl = validateBaseUrl(input.baseUrl);

    const id = crypto.randomUUID();
    const isSpeech = input.kind === 'speech';
    const newModel = {
      id,
      name: String(input.name).trim(),
      kind: input.kind,
      baseUrl,
      model: String(input.model).trim(),
      apiKey: input.apiKey ? String(input.apiKey).trim() : '',
    };

    if (isSpeech) {
      newModel.voice = input.voice && String(input.voice).trim() ? String(input.voice).trim() : 'marin';
    } else {
      newModel.temperature = typeof input.temperature === 'number' && !Number.isNaN(input.temperature)
        ? input.temperature
        : null;
    }

    const data = this.load();
    data.models.push(newModel);

    // 如果对应 kind 当前没有选中的模型，自动设为当前项
    if (input.kind === 'text' && !data.activeTextId) {
      data.activeTextId = id;
    } else if (input.kind === 'speech' && !data.activeSpeechId) {
      data.activeSpeechId = id;
    }

    this.save(data);
    return toSafeModel(newModel);
  }

  updateModel(id, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid patch');
    const data = this.load();
    const idx = data.models.findIndex(m => m.id === id);
    if (idx < 0) throw new Error('Model not found');
    const current = data.models[idx];

    if (patch.name !== undefined) {
      if (!String(patch.name).trim()) throw new Error('Model name cannot be empty');
      current.name = String(patch.name).trim();
    }
    if (patch.baseUrl !== undefined) {
      const nextUrl = validateBaseUrl(patch.baseUrl);
      // Credentials belong to this endpoint. Changing it requires explicit re-entry.
      if (nextUrl !== current.baseUrl) current.apiKey = '';
      current.baseUrl = nextUrl;
    }
    if (patch.model !== undefined) {
      if (!String(patch.model).trim()) throw new Error('Model identifier cannot be empty');
      current.model = String(patch.model).trim();
    }
    // 更新时省略 apiKey 表示保留原密钥；显式空字符串表示清除。
    if (patch.apiKey !== undefined) {
      current.apiKey = String(patch.apiKey).trim();
    }
    if (current.kind === 'speech' && patch.voice !== undefined) {
      current.voice = String(patch.voice).trim() || 'marin';
    }
    if (current.kind === 'text' && patch.temperature !== undefined) {
      current.temperature = typeof patch.temperature === 'number' && !Number.isNaN(patch.temperature)
        ? patch.temperature
        : null;
    }

    current.baseUrl = validateBaseUrl(current.baseUrl);
    this.save(data);
    return toSafeModel(current);
  }

  deleteModel(id) {
    const data = this.load();
    const idx = data.models.findIndex(m => m.id === id);
    if (idx < 0) return false;
    const deleted = data.models[idx];
    data.models.splice(idx, 1);

    // 删除当前正在使用的配置时，自动改选同 kind 的另一条；同 kind 没有剩余配置时，text 回退到环境变量，speech 回退到 Browser voice。
    if (deleted.kind === 'text' && data.activeTextId === id) {
      const remaining = data.models.find(m => m.kind === 'text');
      data.activeTextId = remaining ? remaining.id : null;
    }
    if (deleted.kind === 'speech' && data.activeSpeechId === id) {
      const remaining = data.models.find(m => m.kind === 'speech');
      data.activeSpeechId = remaining ? remaining.id : null;
    }

    this.save(data);
    return true;
  }

  // Validate a complete preferences draft without touching the real models file.
  // Reuse the regular CRUD rules (including endpoint-bound credentials) in memory.
  prepareDraft(draft, snapshot = this.load()) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !Array.isArray(draft.models)) {
      throw new Error('modelDraft must contain a models array');
    }
    for (const field of ['activeTextId', 'activeSpeechId']) {
      if (!Object.hasOwn(draft, field) || (draft[field] !== null && typeof draft[field] !== 'string')) {
        throw new Error(`modelDraft.${field} must be a string or null`);
      }
    }
    const existing = new Map(snapshot.models.map(model => [model.id, model]));
    const ids = new Set();
    for (const model of draft.models) {
      if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error('Invalid model data');
      if (typeof model.id !== 'string' || !model.id.trim() || ids.has(model.id)) throw new Error('Model IDs must be nonempty and unique');
      ids.add(model.id);
      const current = existing.get(model.id);
      if (!current && !/^draft-.+/.test(model.id)) throw new Error('New model ID must start with draft-');
      if (!['text', 'speech'].includes(model.kind)) throw new Error('Model kind must be text or speech');
      if (current && current.kind !== model.kind) throw new Error('Existing model kind cannot change');
      for (const field of ['name', 'model']) {
        if (typeof model[field] !== 'string' || !model[field].trim()) throw new Error(`Model ${field} is required`);
      }
      validateBaseUrl(model.baseUrl);
      if (model.apiKey !== undefined && typeof model.apiKey !== 'string') throw new Error('apiKey must be a string');
      if (model.voice !== undefined && typeof model.voice !== 'string') throw new Error('voice must be a string');
      if (model.temperature !== undefined && model.temperature !== null && (typeof model.temperature !== 'number' || !Number.isFinite(model.temperature))) {
        throw new Error('temperature must be a finite number or null');
      }
    }

    let state = structuredClone(snapshot);
    const memory = Object.create(ModelStore.prototype);
    memory.load = () => structuredClone(state);
    memory.save = next => { state = structuredClone(next); };
    for (const model of snapshot.models) {
      if (!ids.has(model.id)) memory.deleteModel(model.id);
    }
    const mappedIds = new Map();
    for (const model of draft.models) {
      if (existing.has(model.id)) {
        memory.updateModel(model.id, model);
        mappedIds.set(model.id, model.id);
      } else {
        mappedIds.set(model.id, memory.addModel(model).id);
      }
    }
    const resolveId = id => {
      if (id === null) return null;
      if (!mappedIds.has(id)) throw new Error('Invalid active model ID');
      return mappedIds.get(id);
    };
    memory.selectActive({
      activeTextId: resolveId(draft.activeTextId),
      activeSpeechId: resolveId(draft.activeSpeechId),
    });
    state.models = draft.models.map(model => state.models.find(saved => saved.id === mappedIds.get(model.id)));
    return state;
  }

  selectActive({ activeTextId, activeSpeechId }) {
    const data = this.load();
    for (const [id, kind] of [[activeTextId, 'text'], [activeSpeechId, 'speech']]) {
      if (id === undefined) continue;
      if (id === null) continue;
      if (typeof id !== 'string' || !data.models.some(m => m.id === id && m.kind === kind)) throw new Error(`Invalid active ${kind} model`);
    }
    if (activeTextId !== undefined) data.activeTextId = activeTextId;
    if (activeSpeechId !== undefined) data.activeSpeechId = activeSpeechId;
    this.save(data);
    return data;
  }

  setActive(id, kind) {
    const data = this.load();
    const target = data.models.find(m => m.id === id);
    if (!target) throw new Error('Model not found');
    if (kind && target.kind !== kind) throw new Error(`Model kind mismatch: expected ${kind}`);

    if (target.kind === 'text') {
      data.activeTextId = id;
    } else if (target.kind === 'speech') {
      data.activeSpeechId = id;
    }

    this.save(data);
    return {
      activeTextId: data.activeTextId,
      activeSpeechId: data.activeSpeechId,
    };
  }
}
