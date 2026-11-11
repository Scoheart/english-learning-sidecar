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

  // Relative time formatter with fallbacks
  function relativeTime(dateValue) {
    if (!dateValue) return '';
    try {
      const now = Date.now();
      const past = new Date(dateValue).getTime();
      const diffMs = now - past;
      const diffSec = Math.floor(diffMs / 1000);
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
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
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
    cursor: 'C',
    claude: 'CL',
    qoder: 'Q',
    pi: 'π',
    dsh: 'DS',
    grok: 'G',
    manual: '✦'
  })[source] || (source ? source.slice(0, 2).toUpperCase() : 'AG');

  const agentName = source => agentNames[source] || source;

  const statusLabels = {
    complete: 'Learned',
    pending: 'Queued',
    processing: 'Learning',
    failed: 'Failed',
    skipped: 'Skipped'
  };

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
  }

  // Audio Speech Synthesis for authentic English pronunciation
  function speakEnglish(text, onEnd) {
    if (!('speechSynthesis' in window)) {
      toast('Speech synthesis is not supported in this browser');
      return;
    }
    window.speechSynthesis.cancel();
    if (!text) return;

    const cleanText = text.replace(/\[Demo preview\]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;

    state.isSpeaking = true;
    utterance.onend = () => {
      state.isSpeaking = false;
      if (typeof onEnd === 'function') onEnd();
      updateSpeakingButtons();
    };
    utterance.onerror = () => {
      state.isSpeaking = false;
      if (typeof onEnd === 'function') onEnd();
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

    // Summary strip metrics
    if ($('metric-total')) $('metric-total').textContent = total;
    if ($('metric-complete')) $('metric-complete').textContent = complete;
    if ($('metric-knowledge')) $('metric-knowledge').textContent = knowledge;

    // Sidebar stats
    if ($('stat-total')) $('stat-total').textContent = total;
    if ($('stat-learned')) $('stat-learned').textContent = complete;
    if ($('stat-words')) $('stat-words').textContent = knowledge;

    // Nav counts
    if ($('count-all')) $('count-all').textContent = total;
    if ($('count-knowledge')) $('count-knowledge').textContent = knowledge;

    // Mode badges & Settings info
    const isLive = state.status?.mode === 'live';
    if ($('mode-badge')) {
      $('mode-badge').textContent = isLive ? 'Live Model' : 'Demo Mode';
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

    // Source filters in sidebar
    const sources = stats.sources || [];
    const sourceContainer = $('source-filters');
    if (sourceContainer) {
      if (sources.length) {
        sourceContainer.innerHTML = sources.map(s => {
          const isSelected = state.sourceFilter === s.source;
          return `
            <button class="source-item ${isSelected ? 'selected' : ''}" data-source="${esc(s.source)}" aria-pressed="${isSelected}" type="button">
              <span class="source-dot ${esc(s.source)}">${esc(initials(s.source))}</span>
              <span>${esc(agentName(s.source))}</span>
              <span class="source-count">${Number(s.count) || 0}</span>
            </button>
          `;
        }).join('');
      } else {
        sourceContainer.innerHTML = '<p class="sidebar-hint">Waiting for agent activity...</p>';
      }
    }

    // Filter clear button & active filter badge in topbar
    const hasSourceFilter = Boolean(state.sourceFilter);
    if ($('clear-source-filter')) {
      $('clear-source-filter').classList.toggle('hidden', !hasSourceFilter);
    }
    if ($('active-filter-badge')) {
      $('active-filter-badge').classList.toggle('hidden', !hasSourceFilter);
      if ($('active-filter-text') && hasSourceFilter) {
        $('active-filter-text').textContent = `Agent: ${agentName(state.sourceFilter)}`;
      }
    }

    // Status tabs selected state
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
        <div class="empty-state">
          <div class="empty-illustration">${icon('book-open')}</div>
          <h3>${noItemsAtAll ? 'Your learning starts here' : 'No matching prompts found'}</h3>
          <p>${noItemsAtAll 
            ? 'Connect your coding agents or trigger a sample prompt below. Sidecar will analyze your inputs asynchronously.' 
            : 'Try refining your search keyword or clearing the status and agent filters.'}</p>
          ${noItemsAtAll && state.status?.demoEnabled ? `
            <button class="cta-button" id="demo-button" type="button">
              ${icon('zap')}
              <span>Try a sample prompt</span>
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    listEl.innerHTML = events.map(e => {
      const isSelected = state.selectedId === e.id;
      const hasTranslation = Boolean(e.analysis?.translation);
      const cleanSnippet = esc(e.content);
      const translationSnippet = hasTranslation ? esc(e.analysis.translation) : '';

      return `
        <button class="prompt-card ${isSelected ? 'active' : ''}" type="button" data-event-id="${esc(e.id)}" aria-pressed="${isSelected}">
          <div class="prompt-card-head">
            <span class="agent-emblem ${esc(e.source)}">${esc(initials(e.source))}</span>
            <strong>${esc(agentName(e.source))}</strong>
            <span class="prompt-timestamp" title="${esc(fullDateTime(e.createdAt))}">${esc(relativeTime(e.createdAt))}</span>
          </div>
          <p class="prompt-snippet">${cleanSnippet}</p>
          ${hasTranslation ? `
            <div class="prompt-translation-preview">
              ${icon('sparkles')}
              <span class="prompt-translation-text">${translationSnippet}</span>
            </div>
          ` : ''}
          <div class="prompt-card-foot">
            <span class="pill ${esc(e.status)}">
              <span class="pill-dot"></span>
              ${esc(statusLabels[e.status] || e.status)}
            </span>
            <span class="prompt-arrow">${icon('arrow-up-right')}</span>
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
        <div class="detail-empty">
          <div class="detail-empty-icon">${icon('book-open')}</div>
          <h3>Select a conversation</h3>
          <p>Your polished English translation, corrections, and key vocabulary will appear here in real time.</p>
        </div>
      `;
      return;
    }

    const a = event.analysis;

    // Corrections section
    let correctionsHtml = '';
    if (a?.corrections?.length) {
      correctionsHtml = `
        <div class="lesson-section">
          <h4>${icon('refresh-cw')} REAL CORRECTIONS & POLISH</h4>
          <div class="corrections-list">
            ${a.corrections.map(c => `
              <div class="correction-card">
                <div class="diff-row before">
                  <span class="diff-tag">BEFORE</span>
                  <span class="diff-content">${esc(c.before)}</span>
                </div>
                <div class="diff-row after">
                  <span class="diff-tag">AFTER</span>
                  <span class="diff-content">${esc(c.after)}</span>
                </div>
                ${c.reason ? `<p class="correction-reason">${esc(c.reason)}</p>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Vocabulary section
    let vocabHtml = '';
    if (a?.vocabulary?.length) {
      vocabHtml = `
        <div class="lesson-section">
          <h4>${icon('book-open')} KEY VOCABULARY & COLLOCATIONS</h4>
          <div class="vocab-grid">
            ${a.vocabulary.map(v => `
              <div class="vocab-card">
                <div class="vocab-header">
                  <div class="vocab-term-group">
                    <span class="vocab-term">${esc(v.term)}</span>
                    <button class="vocab-speaker-btn" type="button" data-speak="${esc(v.term)}" title="Pronounce word" aria-label="Pronounce ${esc(v.term)}">
                      ${icon('volume-2')}
                    </button>
                  </div>
                </div>
                <div class="vocab-meaning">${esc(v.meaning)}</div>
                ${v.usage ? `<div class="vocab-usage"><code>${esc(v.usage)}</code></div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Grammar & Patterns section
    let grammarHtml = '';
    if (a?.grammar?.length) {
      grammarHtml = `
        <div class="lesson-section">
          <h4>${icon('cpu')} GRAMMAR & SENTENCE PATTERNS</h4>
          <div class="grammar-entries">
            ${a.grammar.map(g => `
              <div class="grammar-card">
                <strong>${esc(g.label)}</strong>
                <p>${esc(g.explanation)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Put it into practice / Examples section
    let examplesHtml = '';
    if (a?.examples?.length) {
      examplesHtml = `
        <div class="lesson-section">
          <h4>${icon('layout-list')} PUT IT INTO PRACTICE (REAL-WORLD PROMPTS)</h4>
          <div class="examples-list">
            ${a.examples.map((x, idx) => `
              <div class="example-card">
                <span class="example-num">${String(idx + 1).padStart(2, '0')}</span>
                <div class="example-content">
                  <strong>${esc(x.english)}</strong>
                  <p>${esc(x.chinese)}</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Editorial callouts
    let notesHtml = '';
    if (a?.notes) {
      notesHtml = `
        <div class="lesson-section">
          <div class="editorial-callout">
            <h4>${icon('lightbulb')} USAGE NOTE</h4>
            <p>${esc(a.notes)}</p>
          </div>
        </div>
      `;
    }

    let summaryHtml = '';
    if (a?.summary) {
      summaryHtml = `
        <div class="lesson-section">
          <div class="editorial-callout" style="background: var(--emerald-soft); border-color: var(--emerald-border);">
            <h4 style="color: var(--emerald) !important;">${icon('check-circle')} KEY TAKEAWAY</h4>
            <p>${esc(a.summary)}</p>
          </div>
        </div>
      `;
    }

    detailCard.innerHTML = `
      <!-- Card Header -->
      <div class="detail-head">
        <div class="detail-head-left">
          <span class="agent-emblem ${esc(event.source)}">${esc(initials(event.source))}</span>
          <div class="detail-title-group">
            <span class="detail-eyebrow">YOUR ENGLISH LESSON</span>
            <h3>Prompt Breakdown</h3>
            <div class="detail-source-row">
              <span>${esc(agentName(event.source))}</span>
              <span class="detail-source-sep">·</span>
              <span title="${esc(fullDateTime(event.createdAt))}">${esc(relativeTime(event.createdAt))}</span>
            </div>
          </div>
        </div>
        <div class="detail-top-actions">
          <button class="action-pill-btn primary" id="copy-translation" type="button" ${!a ? 'disabled' : ''} title="Copy fluent English translation">
            <span class="copy-icon">${icon('copy')}</span>
            <span class="copy-text">Copy English</span>
          </button>
        </div>
      </div>

      <!-- The Transformation Showcase -->
      <div class="transform-container">
        <!-- Original Prompt Bubble -->
        <div class="original-prompt-card">
          <div class="section-label-bar">
            <span class="section-label">${icon('terminal')} WHAT YOU SUBMITTED</span>
          </div>
          <p>${esc(event.content)}</p>
        </div>

        <!-- Transformation Connector Divider -->
        <div class="transform-divider">
          <span class="transform-pill">
            ${icon('arrow-down')}
            <span>Polished into Authentic English</span>
          </span>
        </div>

        <!-- Natural English Hero Card -->
        ${a ? `
          <div class="translation-hero-card">
            <div class="hero-header">
              <span class="hero-label">${icon('sparkles')} NATURAL & IDIOMATIC EXPRESSION</span>
              <div class="hero-actions">
                <button class="icon-action-btn speak-btn ${state.isSpeaking ? 'speaking' : ''}" id="listen-translation" type="button" title="Pronounce translation" aria-label="Listen to pronunciation">
                  <span class="speak-icon">${icon(state.isSpeaking ? 'volume-x' : 'volume-2')}</span>
                </button>
                <button class="icon-action-btn" id="hero-copy-btn" type="button" title="Quick copy" aria-label="Copy English text">
                  <span class="hero-copy-icon">${icon('copy')}</span>
                </button>
              </div>
            </div>
            <div class="translation-text">${esc(a.translation)}</div>
            ${state.status?.mode === 'demo' ? `
              <div class="demo-disclaimer">
                ${icon('circle-help')}
                <span>Demo preview data · Set LEARNING_API_KEY in .env for genuine AI prompt tutoring.</span>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="waiting-lesson">
            <div class="waiting-glyph">${icon(event.status === 'failed' ? 'circle-help' : 'clock')}</div>
            <h4>${esc(statusLabels[event.status] || event.status)}</h4>
            <p>${esc(event.error || (event.status === 'skipped' ? 'Only natural language prompts are analyzed.' : 'Your English lesson is prepared quietly in the background.'))}</p>
          </div>
        `}
      </div>

      <!-- Detailed Breakdown Sections -->
      ${correctionsHtml}
      ${vocabHtml}
      ${grammarHtml}
      ${examplesHtml}
      ${notesHtml}
      ${summaryHtml}

      <!-- Bottom Card Action Footer -->
      <div class="detail-actions-footer">
        <div>
          ${event.status === 'failed' ? `
            <button class="action-pill-btn" id="retry-lesson" type="button">
              ${icon('refresh-cw')}
              <span>Retry Analysis</span>
            </button>
          ` : ''}
        </div>
        <button class="action-pill-btn danger-btn" id="delete-lesson" type="button" title="Delete this conversation">
          ${icon('trash')}
          <span>Delete Record</span>
        </button>
      </div>
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
          <div class="empty-illustration">${icon('library')}</div>
          <h3>No matching knowledge items</h3>
          <p>As you prompt your coding agents, vocabulary and grammar patterns are automatically extracted and organized into your library.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map(v => {
      const isVocab = v.category === 'vocabulary';
      return `
        <article class="knowledge-card">
          <div class="knowledge-card-top">
            <span class="knowledge-kind-tag ${esc(v.category)}">${esc(v.category)}</span>
            <span class="knowledge-encounters">${Number(v.encounters) || 1} lesson${Number(v.encounters) === 1 ? '' : 's'}</span>
          </div>
          <div class="knowledge-card-title-row">
            <h3>${esc(v.term)}</h3>
            ${isVocab ? `
              <button class="vocab-speaker-btn" type="button" data-speak="${esc(v.term)}" title="Pronounce word" aria-label="Pronounce ${esc(v.term)}">
                ${icon('volume-2')}
              </button>
            ` : ''}
          </div>
          <p>${esc(v.meaning)}</p>
          <div class="knowledge-card-footer">
            <span>Last observed ${esc(relativeTime(v.last_seen))}</span>
            <span title="${esc(fullDateTime(v.last_seen))}">${esc(fullDateTime(v.last_seen))}</span>
          </div>
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
      toast(`Unable to update data: ${error.message}`);
    }
  }

  function switchView(name) {
    if (name !== 'feed' && name !== 'knowledge') return;
    state.view = name;

    const feedEl = $('feed-view');
    const knowledgeEl = $('knowledge-view');
    if (feedEl) feedEl.classList.toggle('hidden', name !== 'feed');
    if (knowledgeEl) knowledgeEl.classList.toggle('hidden', name !== 'knowledge');

    if ($('page-title')) {
      $('page-title').textContent = name === 'feed'
        ? 'English, in your flow.'
        : 'Your Personal English Library.';
    }
    if ($('page-description')) {
      $('page-description').textContent = name === 'feed'
        ? 'Transforming your coding prompts into natural, authentic engineering English.'
        : 'Curated vocabulary and structural patterns learned from your genuine coding prompts.';
    }
    if ($('breadcrumb')) {
      $('breadcrumb').textContent = name === 'feed' ? 'Learning Feed' : 'Knowledge Base';
    }

    document.querySelectorAll('[data-view]').forEach(btn => {
      const selected = btn.dataset.view === name;
      btn.classList.toggle('active', selected);
      if (selected) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  // Copy helper with visual feedback
  async function copyText(text, btnElement) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied English expression to clipboard');
      if (btnElement) {
        const textSpan = btnElement.querySelector('.copy-text');
        const iconSpan = btnElement.querySelector('.copy-icon') || btnElement.querySelector('.hero-copy-icon');
        const origText = textSpan ? textSpan.textContent : '';
        if (textSpan) textSpan.textContent = 'Copied!';
        if (iconSpan) iconSpan.innerHTML = icon('check');

        setTimeout(() => {
          if (textSpan) textSpan.textContent = origText;
          if (iconSpan) iconSpan.innerHTML = icon('copy');
        }, 2000);
      }
    } catch {
      toast('Unable to copy in this browser environment');
    }
  }

  // Event Listeners
  document.addEventListener('click', async event => {
    // Navigation switch
    const nav = event.target.closest('[data-view]');
    if (nav) {
      switchView(nav.dataset.view);
      return;
    }

    // Source filter in sidebar
    const sourceBtn = event.target.closest('[data-source]');
    if (sourceBtn) {
      const source = sourceBtn.dataset.source;
      state.sourceFilter = state.sourceFilter === source ? '' : source;
      switchView('feed');
      render();
      return;
    }

    // Clear source filter buttons
    if (event.target.closest('#clear-source-filter') || event.target.closest('#remove-filter-btn')) {
      state.sourceFilter = '';
      render();
      return;
    }

    // Status filter
    const statusBtn = event.target.closest('[data-status]');
    if (statusBtn) {
      state.statusFilter = statusBtn.dataset.status;
      render();
      return;
    }

    // Knowledge Category Tab
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

    // Prompt selection in list
    const promptRow = event.target.closest('[data-event-id]');
    if (promptRow) {
      state.selectedId = promptRow.dataset.eventId;
      renderFeed();
      renderDetail();
      if (window.matchMedia?.('(max-width: 990px)').matches) {
        $('detail-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    // Audio speech button (for specific word)
    const speakBtn = event.target.closest('[data-speak]');
    if (speakBtn) {
      const word = speakBtn.dataset.speak;
      speakEnglish(word);
      return;
    }

    // Audio speech button (for whole translation)
    if (event.target.closest('#listen-translation')) {
      const currentEvent = state.events.find(e => e.id === state.selectedId);
      if (currentEvent?.analysis?.translation) {
        speakEnglish(currentEvent.analysis.translation);
      }
      return;
    }

    // Settings modal open
    if (event.target.closest('#settings-button') || event.target.closest('#top-settings-button')) {
      $('settings-dialog')?.showModal();
      return;
    }

    // Copy Translation buttons
    const copyBtn = event.target.closest('#copy-translation') || event.target.closest('#hero-copy-btn');
    if (copyBtn) {
      const currentEvent = state.events.find(e => e.id === state.selectedId);
      const text = currentEvent?.analysis?.translation?.replace(/\[Demo preview\]/g, '').trim();
      copyText(text, copyBtn);
      return;
    }

    // Retry failed lesson
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

    // Delete record
    if (event.target.closest('#delete-lesson')) {
      if (!window.confirm('Delete this conversation record from local SQLite?')) return;
      try {
        await api(`/api/events/${state.selectedId}`, { method: 'DELETE' });
        state.selectedId = null;
        await refresh();
        toast('Conversation record removed');
      } catch (e) {
        toast(e.message);
      }
      return;
    }

    // Sample / Demo Prompt trigger buttons
    if (event.target.closest('#demo-button') || event.target.closest('#top-demo-btn')) {
      try {
        const prompts = [
          '帮我重构一遍 UI，现在太丑了。',
          '请帮我排查一下内存泄漏的问题，定位具体的泄露点。',
          '这个 API 需要支持高并发和幂等性处理。',
          '帮我写一个自动化部署脚本，兼容 Docker 和 K8s 环境。'
        ];
        const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
        await api('/api/demo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: randomPrompt })
        });
        toast('Sample prompt queued for analysis');
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    }
  });

  // Search inputs
  if ($('feed-search')) {
    $('feed-search').addEventListener('input', e => {
      state.search = e.target.value;
      renderFeed();
    });
  }

  if ($('knowledge-search')) {
    $('knowledge-search').addEventListener('input', e => {
      state.knowledgeSearch = e.target.value;
      renderKnowledge();
    });
  }

  // Keyboard navigation & Shortcuts
  document.addEventListener('keydown', e => {
    // Focus search on '/' or '⌘K'
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

    // Quick open settings with '⌘,'
    if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('settings-dialog')?.showModal();
      return;
    }

    // List navigation with 'j'/'k' or Arrow keys when not in input
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
          copyText(currentEvent.analysis.translation.replace(/\[Demo preview\]/g, '').trim());
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

    const activeEl = document.querySelector('.prompt-card.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Settings: Capture Toggle
  if ($('capture-toggle')) {
    $('capture-toggle').addEventListener('change', async e => {
      try {
        await api('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paused: !e.target.checked })
        });
        toast(e.target.checked ? 'Prompt capture resumed' : 'Prompt capture paused');
        await refresh();
      } catch (error) {
        e.target.checked = !e.target.checked;
        toast(error.message);
      }
    });
  }

  // Theme Management (Light / Dark)
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

  if ($('theme-toggle')) {
    $('theme-toggle').addEventListener('click', () => {
      const current = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(current);
    });
  }

  // Today Date Display
  if ($('current-day')) {
    $('current-day').textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    }).format(new Date());
  }

  // SSE Stream Setup for Live Real-Time Updates
  const stream = new EventSource('/api/stream');
  stream.addEventListener('update', refresh);
  stream.addEventListener('error', () => {
    $('connection-light')?.classList.remove('online');
    if ($('connection-label')) $('connection-label').textContent = 'Reconnecting';
  });
  stream.addEventListener('open', () => {
    $('connection-light')?.classList.add('online');
    if ($('connection-label')) $('connection-label').textContent = 'Local service';
    refresh();
  });

  refresh();
})();
