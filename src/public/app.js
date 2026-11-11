(() => {
  'use strict';

  const icons = window.SidecarIcons;
  const icon = (name, cls = '') => icons.svg(name, cls);
  icons.hydrate();

  const state = {
    events: [],
    knowledge: [],
    status: null,
    selectedId: null,
    statusFilter: '',
    sourceFilter: '',
    category: 'all',
    view: 'feed',
    search: '',
    knowledgeSearch: '',
    isSpeaking: false,
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function relativeTime(dateValue) {
    if (!dateValue) return '';
    try {
      const diffSec = Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);
      if (diffSec < 45) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHour < 24) return `${diffHour}h ago`;
      if (diffDay < 7) return `${diffDay}d ago`;
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(dateValue));
    } catch {
      return '';
    }
  }

  function fullDateTime(dateValue) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(dateValue));
    } catch {
      return '';
    }
  }

  const agentNames = {
    codex: 'Codex',
    cursor: 'Cursor',
    claude: 'Claude Code',
    qoder: 'Qoder',
    pi: 'Pi',
    dsh: 'DSH',
    grok: 'Grok Build',
    manual: 'Demo'
  };

  const initials = source => ({
    codex: 'CX',
    cursor: 'CU',
    claude: 'CL',
    qoder: 'QD',
    pi: 'π',
    dsh: 'DS',
    grok: 'GK',
    manual: '✦'
  })[source] || (source ? source.slice(0, 2).toUpperCase() : 'AG');

  const agentName = source => agentNames[source] || source;

  const statusLabels = {
    complete: 'Learned',
    pending: 'Queued',
    processing: 'Analyzing',
    failed: 'Failed',
    skipped: 'Skipped'
  };

  const correctionBadges = {
    translated: 'Translated · ZH → EN',
    natural: 'Natural English',
    natural_but_improvable: 'Polished for Fluency',
    needs_correction: 'Corrected & Refined'
  };

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
  }

  function speakEnglish(text) {
    if (!('speechSynthesis' in window)) {
      toast('Speech synthesis is unavailable in this browser');
      return;
    }
    window.speechSynthesis.cancel();
    if (!text) return;

    const cleanText = text.replace(/\[Demo preview\]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    utterance.rate = 0.94;

    state.isSpeaking = true;
    utterance.onend = () => {
      state.isSpeaking = false;
      updateSpeakingButtons();
    };
    utterance.onerror = () => {
      state.isSpeaking = false;
      updateSpeakingButtons();
    };

    window.speechSynthesis.speak(utterance);
    updateSpeakingButtons();
  }

  function updateSpeakingButtons() {
    document.querySelectorAll('.speak-btn').forEach(btn => {
      btn.classList.toggle('speaking', state.isSpeaking);
      const iconWrap = btn.querySelector('.speak-icon');
      if (iconWrap) {
        iconWrap.innerHTML = icon(state.isSpeaking ? 'volume-x' : 'volume-2');
      }
    });
  }

  // Highlight vocabulary terms inside the main English translation
  function highlightTerms(translation, vocabulary = []) {
    const clean = String(translation ?? '').replace(/\s*\[Demo preview\]\s*/g, '');
    const terms = (vocabulary || [])
      .map(v => String(v.term || '').trim())
      .filter(t => t.length >= 3)
      .sort((a, b) => b.length - a.length);

    if (!terms.length) return esc(clean);

    const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escapedTerms.join('|')})\\b`, 'gi');

    let lastIndex = 0;
    let html = '';
    let match;
    while ((match = regex.exec(clean)) !== null) {
      html += esc(clean.slice(lastIndex, match.index));
      html += `<mark class="hero-term-mark" data-speak="${esc(match[0])}" title="Click to pronounce">${esc(match[0])}</mark>`;
      lastIndex = regex.lastIndex;
    }
    html += esc(clean.slice(lastIndex));
    return html;
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function renderStats() {
    const stats = state.status?.stats || {};
    const total = stats.total ?? 0;
    const complete = stats.complete ?? 0;
    const knowledge = stats.knowledge ?? 0;

    if ($('metric-total')) $('metric-total').textContent = total;
    if ($('metric-complete')) $('metric-complete').textContent = complete;
    if ($('metric-knowledge')) $('metric-knowledge').textContent = knowledge;
    if ($('count-all')) $('count-all').textContent = total;
    if ($('count-knowledge')) $('count-knowledge').textContent = knowledge;

    const isLive = state.status?.mode === 'live';
    if ($('mode-badge')) {
      $('mode-badge').textContent = isLive ? 'Live' : 'Demo';
      $('mode-badge').classList.toggle('live', isLive);
    }
    if ($('top-demo-btn')) {
      $('top-demo-btn').classList.toggle('hidden', !state.status?.demoEnabled);
    }
    if ($('settings-model')) {
      $('settings-model').textContent = state.status?.model || 'Demo preview';
    }
    if ($('settings-mode')) {
      $('settings-mode').textContent = isLive ? 'LIVE' : 'DEMO';
    }
    if ($('capture-toggle')) {
      $('capture-toggle').checked = !state.status?.paused;
    }

    const sources = stats.sources || [];
    const sourceContainer = $('source-filters');
    if (sourceContainer) {
      if (sources.length > 1 || state.sourceFilter) {
        sourceContainer.innerHTML = sources.map(s => {
          const isSelected = state.sourceFilter === s.source;
          return `<button class="source-chip ${isSelected ? 'selected' : ''}" data-source="${esc(s.source)}" aria-pressed="${isSelected}" type="button">${esc(agentName(s.source))} <span>${Number(s.count) || 0}</span></button>`;
        }).join('');
      } else {
        sourceContainer.innerHTML = '';
      }
    }

    document.querySelectorAll('[data-status]').forEach(btn => {
      const selected = btn.dataset.status === state.statusFilter;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }

  function matchesStatus(event) {
    if (!state.statusFilter) return true;
    if (state.statusFilter === 'pending') {
      return event.status === 'pending' || event.status === 'processing';
    }
    return event.status === state.statusFilter;
  }

  function renderFeed() {
    const query = state.search.trim().toLocaleLowerCase();
    const events = state.events.filter(e => {
      const sourceMatch = !state.sourceFilter || e.source === state.sourceFilter;
      const statusMatch = matchesStatus(e);
      const text = `${e.content || ''} ${e.analysis?.translation || ''} ${agentName(e.source)}`.toLocaleLowerCase();
      const searchMatch = !query || text.includes(query);
      return sourceMatch && statusMatch && searchMatch;
    });

    if ($('visible-count')) {
      $('visible-count').textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`;
    }

    const listEl = $('prompt-list');
    if (!listEl) return;

    if (!events.length) {
      const noItemsAtAll = state.events.length === 0;
      listEl.innerHTML = `
        <div class="empty-inbox">
          <p class="empty-inbox-title">${noItemsAtAll ? 'No prompts captured yet' : 'No matching prompts'}</p>
          <p class="empty-inbox-sub">${noItemsAtAll
            ? 'Submit a prompt in your coding agent or try a sample lesson.'
            : 'Try clearing your filter or search query.'}</p>
          ${noItemsAtAll && state.status?.demoEnabled ? `
            <button class="sample-cta-btn" id="demo-button" type="button">
              ${icon('zap')} <span>Load sample lessons</span>
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    listEl.innerHTML = events.map(e => {
      const isSelected = state.selectedId === e.id;
      const cleanTranslation = (e.analysis?.translation || '').replace(/\s*\[Demo preview\]\s*/g, '');

      return `
        <button class="inbox-item ${isSelected ? 'active' : ''}" type="button" data-event-id="${esc(e.id)}" aria-pressed="${isSelected}">
          <div class="inbox-item-top">
            <span class="status-pip ${esc(e.status)}" title="${esc(statusLabels[e.status] || e.status)}"></span>
            <span class="inbox-prompt">${esc(e.content)}</span>
          </div>
          ${cleanTranslation ? `<div class="inbox-translation">${esc(cleanTranslation)}</div>` : ''}
          <div class="inbox-meta">
            <span class="inbox-agent ${esc(e.source)}">${esc(agentName(e.source))}</span>
            <span class="inbox-dot">·</span>
            <span>${esc(relativeTime(e.createdAt))}</span>
          </div>
        </button>
      `;
    }).join('');
  }

  function renderDetail() {
    const detailCard = $('detail-card');
    if (!detailCard) return;

    const event = state.events.find(e => e.id === state.selectedId);
    if (!event) {
      detailCard.innerHTML = `
        <div class="stage-empty">
          <div class="stage-empty-icon">${icon('book-open')}</div>
          <h2>Select a prompt to study</h2>
          <p>Your natural English expression, sentence structure breakdown, vocabulary collocations, and practice examples will open here.</p>
          ${state.status?.demoEnabled && state.events.length === 0 ? `
            <button class="sample-cta-btn" id="demo-button" type="button">
              ${icon('zap')} <span>Generate Sample Lesson</span>
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    const a = event.analysis;
    const badgeText = a ? (correctionBadges[a.correctionStatus] || 'English Lesson') : (statusLabels[event.status] || event.status);

    // Corrections / Refinement strip
    const correctionsHtml = a?.corrections?.length ? `
      <section class="refinement-section" aria-label="Expression refinement">
        <div class="section-kicker">${icon('sparkles')} EXPRESSION REFINEMENT (地道表达进阶)</div>
        <div class="refinement-grid">
          ${a.corrections.map(c => `
            <div class="refinement-item">
              <div class="refinement-pair">
                <div class="refinement-before">
                  <span class="diff-badge avoid">LITERAL / AVOID</span>
                  <span class="diff-strike">${esc(c.before)}</span>
                </div>
                <span class="refinement-arrow">${icon('arrow-right')}</span>
                <div class="refinement-after">
                  <span class="diff-badge prefer">NATIVE / PREFER</span>
                  <strong class="diff-good">${esc(c.after)}</strong>
                </div>
              </div>
              ${c.reason ? `<p class="refinement-reason">${esc(c.reason)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </section>
    ` : '';

    // Left Study Column: Vocabulary & Collocations
    const vocabHtml = a?.vocabulary?.length ? `
      <div class="study-panel">
        <div class="panel-header">
          <span class="panel-num">01</span>
          <h3>Vocabulary & Collocations</h3>
          <span class="panel-sub">高频技术词汇与搭配</span>
        </div>
        <div class="vocab-list">
          ${a.vocabulary.map(v => `
            <div class="vocab-item">
              <div class="vocab-main">
                <button class="vocab-word-btn" type="button" data-speak="${esc(v.term)}" title="Click to pronounce ${esc(v.term)}">
                  <strong class="vocab-word">${esc(v.term)}</strong>
                  <span class="vocab-audio-icon">${icon('volume-2')}</span>
                </button>
                <span class="vocab-def">${esc(v.meaning)}</span>
              </div>
              ${v.usage ? `
                <div class="vocab-collocation" data-speak="${esc(v.usage)}" title="Click to pronounce collocation">
                  <span class="collocation-prefix">e.g.</span>
                  <code>${esc(v.usage)}</code>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    // Right Study Column: Grammar + Practice Examples
    const grammarHtml = a?.grammar?.length ? `
      <div class="study-subpanel">
        <div class="panel-header">
          <span class="panel-num">02</span>
          <h3>Sentence Structure</h3>
          <span class="panel-sub">句法与结构拆解</span>
        </div>
        <div class="grammar-list">
          ${a.grammar.map(g => `
            <div class="grammar-item">
              <div class="grammar-formula">${esc(g.label)}</div>
              <p class="grammar-desc">${esc(g.explanation)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const examplesHtml = a?.examples?.length ? `
      <div class="study-subpanel">
        <div class="panel-header">
          <span class="panel-num">03</span>
          <h3>Put It Into Practice</h3>
          <span class="panel-sub">同类工程场景举一反三</span>
        </div>
        <div class="practice-list">
          ${a.examples.map((x, idx) => `
            <div class="practice-item">
              <span class="practice-idx">${String(idx + 1).padStart(2, '0')}</span>
              <div class="practice-body">
                <div class="practice-en-row">
                  <strong class="practice-en">${esc(x.english)}</strong>
                  <button class="mini-speak-btn" type="button" data-speak="${esc(x.english)}" title="Listen to example" aria-label="Listen to example">
                    ${icon('volume-2')}
                  </button>
                </div>
                <p class="practice-zh">${esc(x.chinese)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const takeawayHtml = (a?.summary || a?.notes) ? `
      <footer class="lesson-takeaway-footer">
        ${a?.summary ? `
          <div class="takeaway-block">
            <span class="takeaway-label">${icon('check-circle')} KEY TAKEAWAY</span>
            <p>${esc(a.summary)}</p>
          </div>
        ` : ''}
        ${a?.notes ? `
          <div class="takeaway-block muted">
            <span class="takeaway-label">${icon('lightbulb')} USAGE CONTEXT</span>
            <p>${esc(a.notes)}</p>
          </div>
        ` : ''}
      </footer>
    ` : '';

    detailCard.innerHTML = `
      <article class="lesson-sheet">
        <!-- Top Meta & Action Bar -->
        <header class="lesson-topbar">
          <div class="lesson-meta-left">
            <span class="agent-badge ${esc(event.source)}">${esc(initials(event.source))}</span>
            <span class="meta-agent-name">${esc(agentName(event.source))}</span>
            <span class="meta-sep">·</span>
            <time class="meta-time" title="${esc(fullDateTime(event.createdAt))}">${esc(relativeTime(event.createdAt))}</time>
            <span class="meta-sep">·</span>
            <span class="lesson-type-tag">${esc(badgeText)}</span>
          </div>

          <div class="lesson-actions">
            <button class="stage-btn speak-btn ${state.isSpeaking ? 'speaking' : ''}" id="listen-translation" type="button" ${!a ? 'disabled' : ''} title="Listen to pronunciation (Space)">
              <span class="speak-icon">${icon(state.isSpeaking ? 'volume-x' : 'volume-2')}</span>
              <span>Listen</span>
            </button>
            <button class="stage-btn primary" id="copy-translation" type="button" ${!a ? 'disabled' : ''} title="Copy English expression (C)">
              <span class="copy-icon">${icon('copy')}</span>
              <span class="copy-text">Copy English</span>
            </button>
            ${event.status === 'failed' ? `
              <button class="stage-btn" id="retry-lesson" type="button">
                ${icon('refresh-cw')}
                <span>Retry</span>
              </button>
            ` : ''}
            <button class="stage-icon-btn danger" id="delete-lesson" type="button" title="Delete this prompt record" aria-label="Delete record">
              ${icon('trash')}
            </button>
          </div>
        </header>

        <!-- Hero Bilingual Stage -->
        <section class="hero-stage" aria-label="Prompt and English translation">
          <div class="source-prompt-block">
            <span class="block-eyebrow">ORIGINAL PROMPT</span>
            <p class="source-prompt-text">${esc(event.content)}</p>
          </div>

          ${a ? `
            <div class="target-english-block">
              <div class="target-eyebrow-row">
                <span class="block-eyebrow accent">${icon('sparkles')} AUTHENTIC ENGINEERING ENGLISH</span>
                <span class="hint-tip">Click highlighted terms or press <kbd>Space</kbd> to pronounce</span>
              </div>
              <h1 class="hero-english-text">${highlightTerms(a.translation, a.vocabulary)}</h1>
            </div>
          ` : `
            <div class="waiting-stage">
              <div class="waiting-icon">${icon(event.status === 'failed' ? 'circle-help' : 'clock')}</div>
              <div>
                <h3>${esc(statusLabels[event.status] || event.status)}</h3>
                <p>${esc(event.error || (event.status === 'skipped' ? 'Only natural-language prompts are analyzed.' : 'Preparing your English breakdown in the background...'))}</p>
              </div>
            </div>
          `}
        </section>

        ${correctionsHtml}

        <!-- 2-Column Deep Learning Workspace -->
        ${a ? `
          <section class="study-workspace" aria-label="Vocabulary, grammar and practice">
            ${vocabHtml}
            <div class="study-right-col">
              ${grammarHtml}
              ${examplesHtml}
            </div>
          </section>
          ${takeawayHtml}
        ` : ''}
      </article>
    `;
  }

  function renderKnowledge() {
    const listEl = $('knowledge-list');
    if (!listEl) return;

    const query = state.knowledgeSearch.trim().toLocaleLowerCase();
    const items = state.knowledge.filter(item => {
      const categoryMatch = state.category === 'all' || item.category === state.category;
      const text = `${item.term || ''} ${item.meaning || ''}`.toLocaleLowerCase();
      const searchMatch = !query || text.includes(query);
      return categoryMatch && searchMatch;
    });

    if (!items.length) {
      listEl.innerHTML = `
        <div class="knowledge-empty">
          <p>No saved vocabulary or grammar patterns match your filter yet.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map(v => {
      const isVocab = v.category === 'vocabulary';
      return `
        <article class="knowledge-card">
          <div class="knowledge-card-top">
            <span class="knowledge-tag ${esc(v.category)}">${esc(v.category)}</span>
            <span class="knowledge-freq">${Number(v.encounters) || 1}× encountered</span>
          </div>
          <div class="knowledge-title-row">
            <h3>${esc(v.term)}</h3>
            ${isVocab ? `
              <button class="mini-speak-btn" type="button" data-speak="${esc(v.term)}" title="Pronounce ${esc(v.term)}" aria-label="Pronounce ${esc(v.term)}">
                ${icon('volume-2')}
              </button>
            ` : ''}
          </div>
          <p class="knowledge-meaning">${esc(v.meaning)}</p>
          <div class="knowledge-meta">Last seen ${esc(relativeTime(v.last_seen))}</div>
        </article>
      `;
    }).join('');
  }

  function render() {
    renderStats();
    renderFeed();
    renderDetail();
    renderKnowledge();
  }

  async function refresh() {
    try {
      const [s, e, k] = await Promise.all([
        api('/api/status'),
        api('/api/events?limit=150'),
        api('/api/knowledge')
      ]);
      state.status = s;
      state.events = e.events;
      state.knowledge = k.knowledge;

      if (!state.selectedId && state.events.length) {
        state.selectedId = state.events[0].id;
      }
      if (state.selectedId && !state.events.some(x => x.id === state.selectedId)) {
        state.selectedId = state.events[0]?.id || null;
      }
      render();
    } catch (error) {
      toast(`Sync error: ${error.message}`);
    }
  }

  function switchView(name) {
    if (name !== 'feed' && name !== 'knowledge') return;
    state.view = name;

    $('feed-view')?.classList.toggle('hidden', name !== 'feed');
    $('knowledge-view')?.classList.toggle('hidden', name !== 'knowledge');
    $('dock-feed-panel')?.classList.toggle('hidden', name !== 'feed');
    $('dock-knowledge-panel')?.classList.toggle('hidden', name !== 'knowledge');

    document.querySelectorAll('[data-view]').forEach(btn => {
      const selected = btn.dataset.view === name;
      btn.classList.toggle('active', selected);
      if (selected) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  async function copyText(text, btnElement) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied English expression');
      if (btnElement) {
        const textSpan = btnElement.querySelector('.copy-text');
        const iconSpan = btnElement.querySelector('.copy-icon');
        const origText = textSpan ? textSpan.textContent : '';
        if (textSpan) textSpan.textContent = 'Copied!';
        if (iconSpan) iconSpan.innerHTML = icon('check');
        setTimeout(() => {
          if (textSpan) textSpan.textContent = origText;
          if (iconSpan) iconSpan.innerHTML = icon('copy');
        }, 1800);
      }
    } catch {
      toast('Clipboard unavailable');
    }
  }

  let sampleIdx = 0;
  const samplePrompts = [
    '这个 API 需要支持高并发和幂等性处理。',
    '请帮我排查一下内存泄漏的问题，定位具体的泄露点。',
    '帮我重构一遍 UI，现在太丑了。',
    '帮我解释 MCP 的生命周期和 Tool Discovery 机制。'
  ];

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]');
    if (nav) {
      switchView(nav.dataset.view);
      return;
    }

    const sourceBtn = event.target.closest('[data-source]');
    if (sourceBtn) {
      const source = sourceBtn.dataset.source;
      state.sourceFilter = state.sourceFilter === source ? '' : source;
      switchView('feed');
      render();
      return;
    }

    const statusBtn = event.target.closest('[data-status]');
    if (statusBtn) {
      state.statusFilter = statusBtn.dataset.status;
      render();
      return;
    }

    const categoryBtn = event.target.closest('[data-category]');
    if (categoryBtn) {
      state.category = categoryBtn.dataset.category;
      document.querySelectorAll('[data-category]').forEach(b => {
        const selected = b.dataset.category === state.category;
        b.classList.toggle('selected', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      renderKnowledge();
      return;
    }

    const speakTarget = event.target.closest('[data-speak]');
    if (speakTarget) {
      speakEnglish(speakTarget.dataset.speak);
      return;
    }

    const promptRow = event.target.closest('[data-event-id]');
    if (promptRow) {
      state.selectedId = promptRow.dataset.eventId;
      renderFeed();
      renderDetail();
      return;
    }

    if (event.target.closest('#listen-translation')) {
      const currentEvent = state.events.find(e => e.id === state.selectedId);
      if (currentEvent?.analysis?.translation) {
        speakEnglish(currentEvent.analysis.translation);
      }
      return;
    }

    if (event.target.closest('#settings-button')) {
      $('settings-dialog')?.showModal();
      return;
    }

    const copyBtn = event.target.closest('#copy-translation');
    if (copyBtn) {
      const currentEvent = state.events.find(e => e.id === state.selectedId);
      const text = currentEvent?.analysis?.translation?.replace(/\[Demo preview\]/g, '').trim();
      copyText(text, copyBtn);
      return;
    }

    if (event.target.closest('#retry-lesson')) {
      try {
        await api(`/api/events/${state.selectedId}/retry`, { method: 'POST' });
        toast('Queued for retry');
        await refresh();
      } catch (e) {
        toast(e.message);
      }
      return;
    }

    if (event.target.closest('#delete-lesson')) {
      if (!window.confirm('Delete this prompt lesson from local storage?')) return;
      try {
        await api(`/api/events/${state.selectedId}`, { method: 'DELETE' });
        state.selectedId = null;
        await refresh();
        toast('Prompt deleted');
      } catch (e) {
        toast(e.message);
      }
      return;
    }

    if (event.target.closest('#demo-button') || event.target.closest('#top-demo-btn')) {
      try {
        const prompt = samplePrompts[sampleIdx % samplePrompts.length];
        sampleIdx += 1;
        const created = await api('/api/demo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        if (created?.id) state.selectedId = created.id;
        toast('Sample lesson added');
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    }
  });

  $('feed-search')?.addEventListener('input', e => {
    state.search = e.target.value;
    renderFeed();
  });

  $('knowledge-search')?.addEventListener('input', e => {
    state.knowledgeSearch = e.target.value;
    renderKnowledge();
  });

  document.addEventListener('keydown', e => {
    if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) &&
        !$('settings-dialog')?.open) {
      e.preventDefault();
      switchView('feed');
      $('feed-search')?.focus();
      return;
    }

    if (e.key === 'Escape') {
      if (document.activeElement === $('feed-search')) $('feed-search').blur();
      if (document.activeElement === $('knowledge-search')) $('knowledge-search').blur();
    }

    if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('settings-dialog')?.showModal();
      return;
    }

    if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !$('settings-dialog')?.open) {
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateList(1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateList(-1);
      } else if (e.key === 'c') {
        const currentEvent = state.events.find(ev => ev.id === state.selectedId);
        if (currentEvent?.analysis?.translation) {
          copyText(currentEvent.analysis.translation.replace(/\[Demo preview\]/g, '').trim(), $('copy-translation'));
        }
      } else if (e.key === ' ' || e.key === 'p') {
        e.preventDefault();
        const currentEvent = state.events.find(ev => ev.id === state.selectedId);
        if (currentEvent?.analysis?.translation) {
          speakEnglish(currentEvent.analysis.translation);
        }
      }
    }
  });

  function navigateList(direction) {
    if (!state.events.length) return;
    const currentIndex = state.events.findIndex(e => e.id === state.selectedId);
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= state.events.length) nextIndex = state.events.length - 1;

    state.selectedId = state.events[nextIndex].id;
    renderFeed();
    renderDetail();

    document.querySelector('.inbox-item.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('capture-toggle')?.addEventListener('change', async e => {
    try {
      await api('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: !e.target.checked })
      });
      toast(e.target.checked ? 'Capture resumed' : 'Capture paused');
      await refresh();
    } catch (error) {
      e.target.checked = !e.target.checked;
      toast(error.message);
    }
  });

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const toggleBtn = $('theme-toggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
      toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    try {
      localStorage.setItem('sidecar-theme', theme);
    } catch {}
  }

  let preferredTheme = 'light';
  try {
    preferredTheme = localStorage.getItem('sidecar-theme') ||
      (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch {}
  setTheme(preferredTheme === 'dark' ? 'dark' : 'light');

  $('theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(current);
  });

  const stream = new EventSource('/api/stream');
  stream.addEventListener('update', refresh);
  stream.addEventListener('error', () => {
    $('connection-light')?.classList.remove('online');
  });
  stream.addEventListener('open', () => {
    $('connection-light')?.classList.add('online');
    refresh();
  });

  refresh();
})();
