(() => {
  'use strict';
  const icons = window.SidecarIcons;
  const icon = name => icons.svg(name);
  icons.hydrate();
  const state = {
    events: [], knowledge: [], status: null, selectedId: null,
    statusFilter: '', sourceFilter: '', category: 'all', view: 'feed', search: '', knowledgeSearch: ''
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const dateText = value => { try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } };
  const agentNames = { codex: 'Codex', cursor: 'Cursor', claude: 'Claude Code', qoder: 'Qoder', pi: 'Pi', dsh: 'DSH', grok: 'Grok Build', manual: 'Demo' };
  const initials = source => ({ codex: 'CX', cursor: 'C', claude: 'CL', qoder: 'Q', pi: 'π', dsh: 'DS', grok: 'G', manual: '✦' })[source] || source.slice(0, 2).toUpperCase();
  const agentName = source => agentNames[source] || source;
  const statusLabels = {complete: 'Learned',pending: 'Queued',processing: 'Learning',failed: 'Failed',skipped: 'Skipped'};
  let toastTimer;

  async function api(url, options) {
    const res = await fetch(url, options);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3400);
  }
  function renderStats() {
    const stats = state.status?.stats || {};
    $('metric-total').textContent = stats.total ?? 0;
    $('metric-complete').textContent = stats.complete ?? 0;
    $('metric-knowledge').textContent = stats.knowledge ?? 0;
    $('count-all').textContent = stats.total ?? 0;
    $('count-knowledge').textContent = stats.knowledge ?? 0;
    $('mode-badge').textContent = state.status?.mode === 'live' ? 'Live model' : 'Demo mode';
    $('mode-badge').classList.toggle('live', state.status?.mode === 'live');
    $('settings-model').textContent = state.status?.model || 'Not configured';
    $('settings-mode').textContent = state.status?.mode === 'live' ? 'LIVE' : 'DEMO';
    $('capture-toggle').checked = !state.status?.paused;
    const sources = stats.sources || [];
    $('source-filters').innerHTML = sources.length
      ? sources.map(s => `<button class="source-item ${state.sourceFilter === s.source ? 'selected' : ''}" data-source="${esc(s.source)}" aria-pressed="${state.sourceFilter === s.source}" type="button"><span class="source-dot ${esc(s.source)}">${esc(initials(s.source))}</span>${esc(agentName(s.source))}<span>${Number(s.count) || 0}</span></button>`).join('')
      : '<p class="sidebar-hint">No activity yet</p>';
    document.querySelectorAll('[data-status]').forEach(btn => {
      const selected = btn.dataset.status === state.statusFilter;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }
  function matchesStatus(event) {
    if (!state.statusFilter) return true;
    if (state.statusFilter === 'pending') return event.status === 'pending' || event.status === 'processing';
    return event.status === state.statusFilter;
  }
  function renderFeed() {
    const query = state.search.trim().toLocaleLowerCase();
    const events = state.events.filter(e => (!state.sourceFilter || e.source === state.sourceFilter)
      && matchesStatus(e) && (!query || String(e.content || '').toLocaleLowerCase().includes(query) || agentName(e.source).toLocaleLowerCase().includes(query)));
    $('visible-count').textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`;
    if (!events.length) {
      const noItems = state.events.length === 0;
      $('prompt-list').innerHTML = `<div class="empty-state"><span class="empty-illustration">${icon('book-open')}</span><h3>${noItems ? 'Your learning starts here' : 'Nothing matched'}</h3><p>${noItems ? 'Connect a coding agent or send a sample prompt. Lessons will arrive automatically, without interrupting your work.' : 'Try another search or clear your filters.'}</p>${noItems && state.status?.demoEnabled ? '<button class="cta-button" id="demo-button" type="button">Try a sample prompt</button>' : ''}</div>`;
      return;
    }
    $('prompt-list').innerHTML = events.map(e => `<button class="prompt-card ${state.selectedId === e.id ? 'active' : ''}" type="button" data-event-id="${esc(e.id)}" aria-pressed="${state.selectedId === e.id}">
      <div class="prompt-card-head"><span class="agent-emblem ${esc(e.source)}">${esc(initials(e.source))}</span><strong>${esc(agentName(e.source))}</strong><span class="prompt-timestamp">${esc(dateText(e.createdAt))}</span></div>
      <p class="prompt-snippet">${esc(e.content)}</p>
      <div class="prompt-card-foot"><span class="pill ${esc(e.status)}"><span class="pill-dot"></span>${esc(statusLabels[e.status] || e.status)}</span><span class="prompt-arrow">${icon('arrow-up-right')}</span></div>
    </button>`).join('');
  }
  function renderDetail() {
    const event = state.events.find(e => e.id === state.selectedId);
    if (!event) {
      $('detail-card').innerHTML = `<div class="detail-empty">${icon('book-open')}<h3>Choose a conversation</h3><p>Your English lesson will appear here.</p></div>`;
      return;
    }
    const a = event.analysis;
    const tag = (label, value) => value ? `<div class="lesson-section"><h4>${esc(label)}</h4><p>${esc(value)}</p></div>` : '';
    const vocab = a?.vocabulary?.length ? `<div class="lesson-section"><h4>VOCABULARY</h4><div class="vocab-list">${a.vocabulary.map(v => `<div class="vocab-row"><strong>${esc(v.term)}</strong><span>${esc(v.meaning)}</span>${v.usage ? `<small>${esc(v.usage)}</small>` : ''}</div>`).join('')}</div></div>` : '';
    const grammar = a?.grammar?.length ? `<div class="lesson-section"><h4>GRAMMAR & STRUCTURE</h4>${a.grammar.map(g => `<div class="grammar-entry"><strong>${esc(g.label)}</strong><p>${esc(g.explanation)}</p></div>`).join('')}</div>` : '';
    const corrections = a?.corrections?.length ? `<div class="lesson-section"><h4>CORRECTIONS</h4>${a.corrections.map(c => `<div class="correction-row"><div class="before">${esc(c.before)}</div><div class="after">${esc(c.after)}</div><p>${esc(c.reason)}</p></div>`).join('')}</div>` : '';
    const examples = a?.examples?.length ? `<div class="lesson-section"><h4>PUT IT INTO PRACTICE</h4>${a.examples.map((x, idx) => `<div class="example-row"><span>${String(idx + 1).padStart(2, '0')}</span><div><strong>${esc(x.english)}</strong><p>${esc(x.chinese)}</p></div></div>`).join('')}</div>` : '';
    $('detail-card').innerHTML = `<div class="detail-head"><div><span class="eyebrow">YOUR ENGLISH LESSON</span><h3>Prompt breakdown</h3></div><span class="agent-emblem ${esc(event.source)}">${esc(initials(event.source))}</span></div>
      <div class="detail-source">${esc(agentName(event.source))}<span>·</span>${esc(dateText(event.createdAt))}</div>
      <div class="original-prompt"><div class="original-heading">ORIGINAL PROMPT</div><p>${esc(event.content)}</p></div>
      ${a ? `<div class="translation-heading">${icon('sparkles')} NATURAL ENGLISH</div><div class="translation">${esc(a.translation)}</div>${state.status?.mode === 'demo' ? '<div class="demo-disclaimer">Demo only · Not a translation of your actual prompt.</div>' : ''}${corrections}${vocab}${grammar}${examples}${tag('USAGE NOTE',a.notes)}${tag('KEY TAKEAWAY',a.summary)}` :
      `<div class="waiting-lesson"><span class="waiting-glyph">${icon(event.status === 'failed' ? 'circle-help' : 'clock')}</span><h4>${esc(statusLabels[event.status] || event.status)}</h4><p>${esc(event.error || (event.status === 'skipped' ? 'Only natural language is analyzed.' : 'Your lesson is prepared separately from the main Agent.'))}</p></div>`}
      <div class="detail-actions"><button class="ghost-button" id="copy-translation" type="button" ${!a ? 'disabled' : ''}>${icon('copy')} Copy English</button>${event.status === 'failed' ? `<button class="ghost-button" id="retry-lesson" type="button">${icon('refresh-cw')} Retry</button>` : ''}<button class="danger-button" id="delete-lesson" type="button">${icon('trash')} Delete</button></div>`;
  }
  function renderKnowledge() {
    const query = state.knowledgeSearch.trim().toLocaleLowerCase();
    const arr = state.knowledge.filter(item => (state.category === 'all' || item.category === state.category)
      && (!query || `${item.term} ${item.meaning}`.toLocaleLowerCase().includes(query)));
    $('knowledge-list').innerHTML = arr.length ? arr.map(v => `<article class="knowledge-card"><div class="knowledge-card-top"><span class="knowledge-kind">${esc(v.category)}</span><span class="knowledge-views">${Number(v.encounters) || 0} lessons</span></div><h3>${esc(v.term)}</h3><p>${esc(v.meaning)}</p><small>Last seen ${esc(dateText(v.last_seen))}</small></article>`).join('') : '<div class="knowledge-empty">No matching knowledge yet. Your library grows with new lessons.</div>';
  }
  function render() { renderStats(); renderFeed(); renderDetail(); renderKnowledge(); }
  async function refresh() {
    try {
      const [s,e,k] = await Promise.all([api('/api/status'), api('/api/events?limit=150'), api('/api/knowledge')]);
      state.status = s; state.events = e.events; state.knowledge = k.knowledge;
      if (!state.selectedId && state.events.length) state.selectedId = state.events[0].id;
      if (state.selectedId && !state.events.some(x => x.id === state.selectedId)) state.selectedId = state.events[0]?.id || null;
      render();
    } catch(error) { toast(`Unable to load: ${error.message}`); }
  }
  function switchView(name) {
    if (name !== 'feed' && name !== 'knowledge') return;
    state.view = name;
    $('feed-view').classList.toggle('hidden', name !== 'feed');
    $('knowledge-view').classList.toggle('hidden', name !== 'knowledge');
    $('page-title').textContent = name === 'feed' ? 'English, in your flow.' : 'A library that grows with you.';
    $('page-description').textContent = name === 'feed' ? "Little lessons from the conversations you're already having." : 'Keep the words, patterns, and phrases that matter.';
    $('breadcrumb').textContent = name === 'feed' ? 'Learning feed' : 'Knowledge base';
    document.querySelectorAll('[data-view]').forEach(btn => {
      const selected = btn.dataset.view === name;
      btn.classList.toggle('active',selected);
      if (selected) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
    });
  }
  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]');
    if (nav) { switchView(nav.dataset.view); return; }
    const source = event.target.closest('[data-source]');
    if (source) {
      state.sourceFilter = state.sourceFilter === source.dataset.source ? '' : source.dataset.source;
      switchView('feed');render();return;
    }
    const status = event.target.closest('[data-status]');
    if (status) {state.statusFilter = status.dataset.status;render();return;}
    const category = event.target.closest('[data-category]');
    if (category) {
      state.category = category.dataset.category;
      document.querySelectorAll('[data-category]').forEach(b => {const selected=b.dataset.category === state.category;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
      renderKnowledge();return;
    }
    const row = event.target.closest('[data-event-id]');
    if (row) {state.selectedId = row.dataset.eventId;renderFeed();renderDetail();if (window.matchMedia?.('(max-width:990px)').matches) $('detail-card').scrollIntoView({behavior:'smooth',block:'start'});return;}
    if (event.target.closest('#settings-button') || event.target.closest('#top-settings-button')) {$('settings-dialog').showModal();return;}
    if (event.target.closest('#copy-translation')) {
      const value = state.events.find(e => e.id === state.selectedId)?.analysis?.translation;
      if (value) {try {await navigator.clipboard.writeText(value);toast('Copied to clipboard');}catch{toast('Copy unavailable in this browser');}}
      return;
    }
    if (event.target.closest('#retry-lesson')) {
      try {await api(`/api/events/${state.selectedId}/retry`,{method:'POST'});toast('Queued for retry');await refresh();}catch(e){toast(e.message);}
      return;
    }
    if (event.target.closest('#delete-lesson')) {
      if (!window.confirm('Delete this locally saved conversation?')) return;
      try {await api(`/api/events/${state.selectedId}`,{method:'DELETE'});state.selectedId=null;await refresh();toast('Record deleted');}catch(e){toast(e.message);}
      return;
    }
    if (event.target.closest('#demo-button')) {
      try {await api('/api/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'帮我解释 MCP 的生命周期和 Tool Discovery 机制。'})});toast('Sample prompt queued');await refresh();}catch(e){toast(e.message);}
    }
  });
  $('feed-search').addEventListener('input',e=>{state.search=e.target.value;renderFeed();});
  $('knowledge-search').addEventListener('input',e=>{state.knowledgeSearch=e.target.value;renderKnowledge();});
  document.addEventListener('keydown',e=>{
    if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !$('settings-dialog').open) {
      e.preventDefault();$('feed-search').focus();switchView('feed');
    }
    if (e.key === 'Escape' && document.activeElement === $('feed-search')) $('feed-search').blur();
  });
  $('capture-toggle').addEventListener('change',async e=>{
    try{await api('/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({paused:!e.target.checked})});toast(e.target.checked?'Capture resumed':'Capture paused');await refresh();}
    catch(error){e.target.checked=!e.target.checked;toast(error.message);}
  });
  function setTheme(name) {
    document.documentElement.dataset.theme=name;
    $('theme-toggle').innerHTML=icon(name==='dark'?'sun':'moon');
    $('theme-toggle').setAttribute('aria-label',name==='dark'?'Switch to light theme':'Switch to dark theme');
    try{localStorage.setItem('sidecar-theme',name);}catch{}
  }
  let preferred='light';
  try{preferred=localStorage.getItem('sidecar-theme')||((window.matchMedia?.('(prefers-color-scheme: dark)').matches)?'dark':'light');}catch{}
  setTheme(preferred==='dark'?'dark':'light');
  $('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  $('current-day').textContent=new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(new Date());
  $('connection-light').classList.add('online');$('connection-label').textContent='Local service';
  const stream=new EventSource('/api/stream');
  stream.addEventListener('update',refresh);
  stream.addEventListener('error',()=>{$('connection-light').classList.remove('online');$('connection-label').textContent='Reconnecting';});
  stream.addEventListener('open',()=>{$('connection-light').classList.add('online');$('connection-label').textContent='Local service';refresh();});
  refresh();
})();
