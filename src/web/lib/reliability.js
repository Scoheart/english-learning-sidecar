// Pure helpers shared by the UI and Node's built-in test runner.
export function modelPayload(form, original) {
  const payload = { name: form.name.trim(), kind: form.kind, baseUrl: form.baseUrl.trim(), model: form.model.trim() };
  if (!payload.name || !payload.baseUrl || !payload.model) throw new Error('请填写名称、Base URL 和模型标识。');
  const key = (form.apiKey || '').trim();
  if (original && payload.baseUrl.replace(/\/+$/, '') !== original.baseUrl.replace(/\/+$/, '') && !key && !form.clearApiKey) {
    throw new Error('Provider Base URL 已更改，请重新输入密钥，或明确选择清除密钥。');
  }
  if (form.kind === 'speech') payload.voice = (form.voice || '').trim() || 'marin';
  else {
    payload.temperature = form.temperature?.trim() ? Number(form.temperature) : null;
    if (payload.temperature !== null && (!Number.isFinite(payload.temperature) || payload.temperature < 0 || payload.temperature > 2)) throw new Error('Temperature 必须为 0–2，或留空。');
  }
  if (form.clearApiKey) payload.apiKey = '';
  else if (key || !form.id) payload.apiKey = key;
  return payload;
}

// Settings changes are immutable local drafts until the single confirmation request.
export function stageSettingsModel(draft, form, makeId = () => crypto.randomUUID()) {
  const original = draft.models.find(m => m.id === form.id);
  const payload = modelPayload(form, original);
  const id = form.id || `draft-${makeId()}`;
  const model = { ...original, ...payload, id };
  if (Object.hasOwn(payload, 'apiKey')) {
    model.apiKeySet = Boolean(payload.apiKey);
    model.apiKeyMasked = payload.apiKey ? '待确认的新密钥' : '';
  }
  const models = original ? draft.models.map(m => m.id === id ? model : { ...m }) : [...draft.models.map(m => ({ ...m })), model];
  return {
    ...draft, models,
    activeTextId: draft.activeTextId || (form.kind === 'text' ? id : null),
    activeSpeechId: draft.activeSpeechId || (form.kind === 'speech' ? id : null),
  };
}

export function removeSettingsModel(draft, id) {
  const models = draft.models.filter(m => m.id !== id).map(m => ({ ...m }));
  return { ...draft, models,
    activeTextId: draft.activeTextId === id ? models.find(m => m.kind === 'text')?.id || null : draft.activeTextId,
    activeSpeechId: draft.activeSpeechId === id ? models.find(m => m.kind === 'speech')?.id || null : draft.activeSpeechId,
  };
}

export function selectMatchingEvent(events, selectedId) {
  return events.find((event) => event.id === selectedId) || events[0] || null;
}

// All async continuations must still own the generation before touching playback.
export function createPlaybackSession({ cancelSpeech, onStop }) {
  let generation = 0;
  let controller = null;
  let audio = null;
  let url = null;
  let revoke = null;
  let text = null;
  function stop() {
    generation += 1;
    controller?.abort();
    controller = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute?.('src');
      audio.load?.();
      audio = null;
    }
    if (url) revoke?.(url);
    url = null;
    revoke = null;
    text = null;
    cancelSpeech();
    onStop();
  }
  return {
    stop,
    get text() { return text; },
    begin(nextText) {
      stop();
      text = nextText;
      controller = new AbortController();
      const token = generation;
      return { signal: controller.signal, current: () => token === generation };
    },
    attach(ticket, nextAudio, nextUrl, revokeUrl) {
      if (!ticket.current()) {
        revokeUrl(nextUrl);
        return false;
      }
      audio = nextAudio;
      url = nextUrl;
      revoke = revokeUrl;
      return true;
    },
  };
}

export async function requireOk(response) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败（HTTP ${response.status}），请重试。`);
  }
  return response;
}
