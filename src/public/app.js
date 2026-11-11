(() => {
  'use strict';
  const state = { events: [], knowledge: [], status: null, selectedId: null, statusFilter: '', sourceFilter: '', category: 'all', view: 'feed' };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const readableDate = value => { try { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } };
  const agentNames = { codex: 'Codex', cursor: 'Cursor', claude: 'Claude Code', qoder: 'Qoder', pi: 'Pi', dsh: 'DSH', manual: 'Demo' };
  const initials = source => ({codex: 'CX', cursor: 'C', claude: 'CL', qoder: 'Q', pi: 'π', dsh: 'DS', manual: '✦'})[source] || source.slice(0, 2).toUpperCase();
  const agentName = source => agentNames[source] || source;
  const statusLabels = {complete: 'Learned', pending: 'Queued', processing: 'Learning', failed: 'Failed', skipped: 'Skipped'};
  let toastTimer;

  async function api(url, options) {
    const res = await fetch(url, options);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }
  function showToast(message) {
    $('toast').textContent = message; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3600);
  }
  function renderStats() {
    const stats = state.status?.stats || {};
    $('metric-total').textContent = stats.total ?? 0;
    $('metric-complete').textContent = stats.complete ?? 0;
    $('metric-knowledge').textContent = stats.knowledge ?? 0;
    $('count-all').textContent = stats.total ?? 0;
    $('count-knowledge').textContent = stats.knowledge ?? 0;
    $('mode-badge').textContent = state.status?.mode === 'live' ? 'LIVE MODEL' : 'DEMO MODE';
    $('mode-badge').classList.toggle('live', state.status?.mode === 'live');
    $('settings-model').textContent = state.status?.model || 'Not configured';
    $('settings-mode').textContent = state.status?.mode === 'live' ? 'LIVE' : 'DEMO';
    $('capture-toggle').checked = !state.status?.paused;
    $('source-filters').innerHTML = (stats.sources || []).length
      ? stats.sources.map(s => `<button class="source-item ${state.sourceFilter === s.source ? 'selected' : ''}" data-source="${esc(s.source)}" type="button"><span class="source-dot ${esc(s.source)}">${esc(initials(s.source))}</span>${esc(agentName(s.source))}<span>${s.count}</span></button>`).join('')
      : '<p class="sidebar-hint">No agent events yet</p>';
    document.querySelectorAll('[data-status]').forEach(btn => btn.classList.toggle('selected', btn.dataset.status === state.statusFilter));
  }
  function matchesStatus(event) {
    if (!state.statusFilter) return true;
    if (state.statusFilter === 'pending') return event.status === 'pending' || event.status === 'processing';
    return event.status === state.statusFilter;
  }
  function renderFeed() {
    const events = state.events.filter(e => (!state.sourceFilter || e.source === state.sourceFilter) && matchesStatus(e));
    if (!events.length) {
      $('prompt-list').innerHTML = `<div class="empty-state"><div class="empty-illustration">✦</div><h3>${state.events.length ? 'No matching lessons' : 'Your language journey begins here'}</h3><p>${state.events.length ? 'Try a different filter.' : 'Connect your first Agent Hook, or run the smoke-test command. New prompts will appear automatically.'}</p>${state.status?.demoEnabled ? '<button class="cta-button" id="demo-button" type="button">Try a sample prompt ↗</button>' : ''}</div>`;
      return;
    }
    $('prompt-list').innerHTML = events.map(e => `<button class="prompt-card ${state.selectedId === e.id ? 'active' : ''}" type="button" data-event-id="${esc(e.id)}">
      <div class="prompt-card-head"><span class="agent-emblem ${esc(e.source)}">${esc(initials(e.source))}</span><strong>${esc(agentName(e.source))}</strong><span class="prompt-timestamp">${esc(readableDate(e.createdAt))}</span></div>
      <p class="prompt-snippet">${esc(e.content)}</p>
      <div class="prompt-card-foot"><span class="pill ${esc(e.status)}"><span class="pill-dot"></span>${esc(statusLabels[e.status] || e.status)}</span><span class="prompt-arrow">↗</span></div>
    </button>`).join('');
  }
  function renderDetail() {
    const event = state.events.find(e => e.id === state.selectedId);
    if (!event) {
      $('detail-card').innerHTML = '<div class="detail-empty"><div class="empty-symbol">✳</div><h3>Your lesson appears here</h3><p>Select a conversation to explore its English insights.</p></div>'; return;
    }
    const a = event.analysis;
    const tag = (label, value) => value ? `<div class="lesson-section"><h4>${esc(label)}</h4><p>${esc(value)}</p></div>` : '';
    const vocab = a?.vocabulary?.length ? `<div class="lesson-section"><h4>VOCABULARY</h4><div class="vocab-list">${a.vocabulary.map(v => `<div class="vocab-row"><strong>${esc(v.term)}</strong><span>${esc(v.meaning)}</span>${v.usage ? `<small>${esc(v.usage)}</small>` : ''}</div>`).join('')}</div></div>` : '';
    const grammar = a?.grammar?.length ? `<div class="lesson-section"><h4>GRAMMAR & STRUCTURE</h4>${a.grammar.map(g => `<div class="grammar-entry"><strong>${esc(g.label)}</strong><p>${esc(g.explanation)}</p></div>`).join('')}</div>` : '';
    const corrections = a?.corrections?.length ? `<div class="lesson-section"><h4>CORRECTIONS</h4>${a.corrections.map(c => `<div class="correction-row"><div class="before">${esc(c.before)}</div><div class="after">${esc(c.after)}</div><p>${esc(c.reason)}</p></div>`).join('')}</div>` : '';
    const examples = a?.examples?.length ? `<div class="lesson-section"><h4>PUT IT INTO PRACTICE</h4>${a.examples.map((x, idx) => `<div class="example-row"><span>0${idx + 1}</span><div><strong>${esc(x.english)}</strong><p>${esc(x.chinese)}</p></div></div>`).join('')}</div>` : '';
    $('detail-card').innerHTML = `<div class="detail-head"><div><span class="eyebrow">LESSON DETAIL</span><h3>Explore this prompt<span class="period">.</span></h3></div><span class="agent-emblem ${esc(event.source)}">${esc(initials(event.source))}</span></div>
      <div class="detail-source">${esc(agentName(event.source))} <span>·</span> ${esc(readableDate(event.createdAt))}</div>
      <div class="original-prompt"><div class="original-heading">YOUR ORIGINAL PROMPT</div><p>${esc(event.content)}</p></div>
      ${a ? `<div class="translation-heading"><span>✦</span> NATURAL ENGLISH</div><div class="translation">${esc(a.translation)}</div>${state.status?.mode === 'demo' ? '<div class="demo-disclaimer">Demo fixture only · Not a translation of your actual prompt.</div>' : ''}${corrections}${vocab}${grammar}${examples}${tag('USAGE NOTE', a.notes)}${tag('KEY TAKEAWAY', a.summary)}` :
        `<div class="waiting-lesson"><div class="waiting-glyph">${event.status === 'failed' ? '!' : '◌'}</div><h4>${esc(statusLabels[event.status] || event.status)}</h4><p>${esc(event.error || (event.status === 'skipped' ? 'Only user-authored natural language is analyzed.' : 'Your learning card is being prepared independently of the main Agent.'))}</p></div>`}
      <div class="detail-actions"><button class="ghost-button" id="copy-translation" type="button" ${!a ? 'disabled' : ''}>Copy English ↗</button>${event.status === 'failed' ? '<button class="ghost-button" id="retry-lesson" type="button">Retry</button>' : ''}<button class="danger-button" id="delete-lesson" type="button">Delete record</button></div>`;
  }
  function renderKnowledge() {
    const arr = state.knowledge.filter(item => state.category === 'all' || item.category === state.category);
    $('knowledge-list').innerHTML = arr.length ? arr.map(v => `<article class="knowledge-card"><div class="knowledge-card-top"><span class="knowledge-kind">${esc(v.category)}</span><span class="knowledge-views">${Number(v.encounters) || 0} lessons</span></div><h3>${esc(v.term)}</h3><p>${esc(v.meaning)}</p><small>Last seen ${esc(readableDate(v.last_seen))}</small></article>`).join('') : '<div class="knowledge-empty">No knowledge items yet. New lessons will populate this library.</div>';
  }
  function render() { renderStats(); renderFeed(); renderDetail(); renderKnowledge(); }
  async function refresh() {
    try {
      const [s, e, k] = await Promise.all([api('/api/status'), api('/api/events?limit=150'), api('/api/knowledge')]);
      state.status = s; state.events = e.events; state.knowledge = k.knowledge;
      if (!state.selectedId && state.events.length) state.selectedId = state.events[0].id;
      if (state.selectedId && !state.events.some(x => x.id === state.selectedId)) state.selectedId = state.events[0]?.id || null;
      render();
    } catch (error) { showToast(`Unable to load: ${error.message}`); }
  }
  function switchView(name) {
    state.view = name;
    $('feed-view').classList.toggle('hidden', name !== 'feed');
    $('knowledge-view').classList.toggle('hidden', name !== 'knowledge');
    $('page-title').innerHTML = name === 'feed' ? 'Learn as you build<span class="period">.</span>' : 'Make knowledge stick<span class="period">.</span>';
    $('page-description').textContent = name === 'feed' ? 'Your coding conversations, transformed into little moments of learning.' : 'A growing library of words and structures, saved from real conversations.';
    $('breadcrumb').textContent = name === 'feed' ? 'Learning feed' : 'Knowledge base';
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  }
  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]'); if (nav) { switchView(nav.dataset.view); return; }
    const source = event.target.closest('[data-source]'); if (source) {
      state.sourceFilter = state.sourceFilter === source.dataset.source ? '' : source.dataset.source;
      switchView('feed'); render(); return;
    }
    const status = event.target.closest('[data-status]'); if (status) { state.statusFilter = status.dataset.status; render(); return; }
    const category = event.target.closest('[data-category]'); if (category) {
      state.category = category.dataset.category;
      document.querySelectorAll('[data-category]').forEach(b => b.classList.toggle('selected', b.dataset.category === state.category));
      renderKnowledge(); return;
    }
    const row = event.target.closest('[data-event-id]'); if (row) { state.selectedId = row.dataset.eventId; renderFeed(); renderDetail(); return; }
    if (event.target.closest('#settings-button')) { $('settings-dialog').showModal(); return; }
    if (event.target.closest('#copy-translation')) {
      const text = state.events.find(e => e.id === state.selectedId)?.analysis?.translation;
      if (text) { try { await navigator.clipboard.writeText(text); showToast('Copied to clipboard'); } catch { showToast('Copy unavailable in this browser'); } } return;
    }
    if (event.target.closest('#retry-lesson')) {
      try { await api(`/api/events/${state.selectedId}/retry`, {method:'POST'}); showToast('Queued for retry'); await refresh(); } catch(e) { showToast(e.message); } return;
    }
    if (event.target.closest('#delete-lesson')) {
      if (!window.confirm('Delete this locally saved conversation?')) return;
      try { await api(`/api/events/${state.selectedId}`, {method:'DELETE'}); state.selectedId = null; await refresh(); showToast('Record deleted'); } catch(e) { showToast(e.message); } return;
    }
    if (event.target.closest('#demo-button')) {
      try { await api('/api/demo', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({prompt:'帮我解释 MCP 的生命周期和 Tool Discovery 机制。'})}); showToast('Sample prompt queued'); await refresh(); } catch(e) { showToast(e.message); }
    }
  });
  $('capture-toggle').addEventListener('change', async e => {
    try { await api('/api/settings', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({paused:!e.target.checked})}); showToast(e.target.checked ? 'Capture resumed' : 'Capture paused'); await refresh(); }
    catch(error) { e.target.checked = !e.target.checked; showToast(error.message); }
  });
  $('current-day').textContent = new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', year:'numeric' }).format(new Date()).toUpperCase();
  $('connection-light').classList.add('online'); $('connection-label').textContent = 'Local service';
  const stream = new EventSource('/api/stream');
  stream.addEventListener('update', refresh);
  stream.addEventListener('error', () => { $('connection-light').classList.remove('online'); $('connection-label').textContent = 'Reconnecting'; });
  stream.addEventListener('open', () => { $('connection-light').classList.add('online'); $('connection-label').textContent = 'Local service'; refresh(); });
  refresh();
})();
