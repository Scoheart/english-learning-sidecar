import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { redactSensitive } from './privacy.js';
import { getOriginalText } from './original-text.js';

const FAVORITE_CATEGORIES = ['vocabulary', 'grammar', 'example'];
const normalizeTerm = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const itemId = (category, term) => crypto.createHash('sha256').update(`${category}:${normalizeTerm(term)}`).digest('hex').slice(0, 32);
const safeText = value => typeof value === 'string' ? redactSensitive(value).trim() : '';
const rows = value => Array.isArray(value) ? value : [];
const parseAnalysis = value => {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
};

function historyOptions({ q = '', category = 'all', offset = 0, limit = 60 } = {}) {
  if (typeof q !== 'string' || q.length > 500) throw new Error('q must be at most 500 characters');
  if (!['all', 'analysis', ...FAVORITE_CATEGORIES].includes(category)) throw new Error('Invalid history category');
  if (!Number.isSafeInteger(Number(offset)) || Number(offset) < 0) throw new Error('offset must be a non-negative integer');
  if (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1) throw new Error('limit must be a positive integer');
  return { q: normalizeTerm(q), category, offset: Number(offset), limit: Math.min(Number(limit), 200) };
}

export class Storage {
  constructor(dataDir) {
    this.db = new DatabaseSync(path.join(dataDir, 'sidecar.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2500;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        analysis TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_recent ON events(created_at DESC);
      CREATE INDEX IF NOT EXISTS events_status ON events(status, created_at);
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL,
        meaning TEXT NOT NULL,
        category TEXT NOT NULL,
        encounters INTEGER NOT NULL DEFAULT 0,
        last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_knowledge (
        event_id TEXT NOT NULL,
        knowledge_id TEXT NOT NULL,
        PRIMARY KEY (event_id, knowledge_id)
      );
      CREATE INDEX IF NOT EXISTS event_knowledge_lookup ON event_knowledge(knowledge_id, event_id);
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL,
        meaning TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('vocabulary','grammar','example')),
        normalized_term TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_id TEXT,
        UNIQUE(category, normalized_term)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Additive migrations preserve existing lessons and settings.
    const eventColumns = this.db.prepare('PRAGMA table_info(events)').all();
    if (!eventColumns.some(c => c.name === 'project_id')) this.db.exec("ALTER TABLE events ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
    const knowledgeColumns = this.db.prepare('PRAGMA table_info(knowledge)').all();
    if (!knowledgeColumns.some(c => c.name === 'retained_encounters')) {
      this.db.exec('ALTER TABLE knowledge ADD COLUMN retained_encounters INTEGER NOT NULL DEFAULT 0');
      this.db.exec(`UPDATE knowledge SET retained_encounters=MAX(0, encounters -
        (SELECT COUNT(*) FROM event_knowledge WHERE knowledge_id=knowledge.id))`);
    }
    if (!knowledgeColumns.some(c => c.name === 'is_primary')) {
      this.db.exec('ALTER TABLE knowledge ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 1');
    }
    this.migrateHistory();
    this.db.prepare("UPDATE events SET status='pending' WHERE status='processing'").run();
  }

  migrateHistory() {
    if (this.getSetting('historyMigrationVersion', 0) >= 1) return;
    this.db.exec('BEGIN');
    try {
      // Merge legacy keys before backfilling. Retained encounters represent events
      // deliberately deleted with knowledge=keep; linked encounters are a set.
      const groups = new Map();
      for (const row of this.db.prepare('SELECT * FROM knowledge ORDER BY last_seen ASC').all()) {
        const id = itemId(row.category, row.term);
        const group = groups.get(id) || { ...row, id, retained_encounters: 0, links: new Set() };
        for (const link of this.db.prepare('SELECT event_id FROM event_knowledge WHERE knowledge_id=?').all(row.id)) group.links.add(link.event_id);
        group.retained_encounters += row.retained_encounters;
        group.term = safeText(row.term);
        group.meaning = safeText(row.meaning);
        group.last_seen = row.last_seen;
        groups.set(id, group);
      }
      this.db.exec('DELETE FROM event_knowledge; DELETE FROM knowledge;');
      for (const group of groups.values()) {
        this.db.prepare(`INSERT INTO knowledge(id,term,meaning,category,encounters,last_seen,retained_encounters,is_primary)
          VALUES (?,?,?,?,?,?,?,?)`).run(group.id, group.term, group.meaning, group.category,
          group.retained_encounters + group.links.size, group.last_seen, group.retained_encounters, group.is_primary);
        for (const eventId of group.links) this.db.prepare('INSERT INTO event_knowledge(event_id,knowledge_id) VALUES (?,?)').run(eventId, group.id);
      }
      for (const event of this.db.prepare('SELECT id,analysis,updated_at FROM events WHERE analysis IS NOT NULL ORDER BY updated_at ASC').all()) {
        this.saveKnowledge(event.id, parseAnalysis(event.analysis), event.updated_at);
      }
      this.setSetting('historyMigrationVersion', 1);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  listFavorites() {
    return this.db.prepare('SELECT id,term,meaning,category,created_at,event_id FROM favorites ORDER BY created_at DESC,id DESC').all();
  }

  addFavorite(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected favorite object');
    const { term, meaning, category, eventId } = input;
    if (typeof term !== 'string' || !term.trim() || term.length > 1200) throw new Error('term must be 1–1200 characters');
    if (typeof meaning !== 'string' || !meaning.trim() || meaning.length > 3000) throw new Error('meaning must be 1–3000 characters');
    if (!FAVORITE_CATEGORIES.includes(category)) throw new Error('Invalid favorite category');
    if (eventId !== undefined && (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId))) throw new Error('Invalid eventId');
    const normalized = normalizeTerm(safeText(term));
    const existing = this.db.prepare('SELECT id,term,meaning,category,created_at,event_id FROM favorites WHERE category=? AND normalized_term=?').get(category, normalized);
    if (existing) return { favorite: existing, duplicate: true, message: '已在收藏夹，无需重复收藏' };
    if (eventId !== undefined && !this.db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) throw new Error('Event not found');
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO favorites(id,term,meaning,category,normalized_term,created_at,event_id) VALUES (?,?,?,?,?,?,?)')
      .run(id, safeText(term).replace(/\s+/gu, ' '), safeText(meaning), category, normalized, new Date().toISOString(), eventId ?? null);
    return { favorite: this.db.prepare('SELECT id,term,meaning,category,created_at,event_id FROM favorites WHERE id=?').get(id), duplicate: false, message: '已加入收藏夹' };
  }

  deleteFavorite(id) {
    return this.db.prepare('DELETE FROM favorites WHERE id=?').run(id).changes > 0;
  }

  listHistory(options = {}) {
    const { q, category, offset, limit } = historyOptions(options);
    const history = [];
    if (category === 'all' || category === 'analysis') {
      const analyses = new Map();
      for (const event of this.db.prepare('SELECT id,content,analysis,status,updated_at FROM events ORDER BY updated_at ASC,id ASC').all()) {
        const analysis = parseAnalysis(event.analysis);
        const term = getOriginalText(redactSensitive(event.content), typeof analysis.originalText === 'string' ? redactSensitive(analysis.originalText) : undefined);
        if (!term) continue;
        const id = `analysis:${itemId('analysis', term)}`;
        const previous = analyses.get(id);
        analyses.set(id, { id, term, meaning: safeText(analysis.translation), category: 'analysis',
          encounters: (previous?.encounters || 0) + 1, last_seen: event.updated_at, event_id: event.id, status: event.status });
      }
      history.push(...analyses.values());
    }
    if (category !== 'analysis') {
      const items = this.db.prepare(`SELECT k.id,k.term,k.meaning,k.category,k.encounters,k.last_seen,
        (SELECT e.id FROM events e JOIN event_knowledge ek ON ek.event_id=e.id
          WHERE ek.knowledge_id=k.id ORDER BY e.updated_at DESC,e.id DESC LIMIT 1) AS event_id
        FROM knowledge k ${category === 'all' ? '' : 'WHERE k.category=?'}`).all(...(category === 'all' ? [] : [category]));
      history.push(...items.map(item => ({ ...item, term: safeText(item.term), meaning: safeText(item.meaning) })));
    }
    const matching = history.filter(item => !q || normalizeTerm(`${item.term} ${item.meaning}`).includes(q));
    matching.sort((a, b) => b.last_seen.localeCompare(a.last_seen) || a.id.localeCompare(b.id));
    return { history: matching.slice(offset, offset + limit), total: matching.length };
  }

  getPaused() {
    return this.db.prepare("SELECT value FROM settings WHERE key='paused'").get()?.value === '1';
  }
  setPaused(paused) {
    this.db.prepare("INSERT INTO settings(key, value) VALUES ('paused', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(paused ? '1' : '0');
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  addEvent(event) {
    const now = new Date().toISOString();
    const base = [event.source, event.eventType, event.sessionId, event.turnId];
    // Real turn IDs are authoritative; without one dedup only within five seconds.
    const bucket = event.turnId ? '' : String(Math.floor(Date.now() / 5000));
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify([...base, bucket, event.content])).digest('hex');
    const existing = this.db.prepare('SELECT id FROM events WHERE fingerprint=? AND created_at > ? LIMIT 1')
      .get(fingerprint, new Date(Date.now() - 86400000).toISOString());
    if (existing) return { id: existing.id, deduplicated: true };
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO events
      (id, fingerprint, source, event_type, session_id, turn_id, content, status, created_at, updated_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, fingerprint, event.source, event.eventType, event.sessionId, event.turnId,
        event.content, event.eligible ? 'pending' : 'skipped', now, now, event.projectId || '');
    return { id, deduplicated: false };
  }

  listEvents({ limit = 80, status = '', source = '' } = {}) {
    const filters = [];
    const args = [];
    if (status) { filters.push('status=?'); args.push(status); }
    if (source) { filters.push('source=?'); args.push(source); }
    return this.db.prepare(`SELECT id, source, event_type AS eventType, session_id AS sessionId,
      turn_id AS turnId, content, status, analysis, error, created_at AS createdAt,
      updated_at AS updatedAt FROM events ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?`).all(...args, Math.min(Math.max(Number(limit) || 80, 1), 150))
      .map(this.deserializeEvent);
  }
  deserializeEvent(row) {
    return row ? { ...row, analysis: row.analysis ? JSON.parse(row.analysis) : null } : null;
  }
  getEvent(id) {
    return this.deserializeEvent(this.db.prepare(`SELECT id, source, event_type AS eventType, session_id AS sessionId,
      turn_id AS turnId, content, status, analysis, error, created_at AS createdAt,
      updated_at AS updatedAt FROM events WHERE id=?`).get(id));
  }
  nextPending() {
    return this.db.prepare("SELECT id, content FROM events WHERE status='pending' ORDER BY created_at ASC LIMIT 1").get();
  }
  setProcessing(id) {
    this.db.prepare("UPDATE events SET status='processing', error=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  }
  finish(id, analysis) {
    this.db.exec('BEGIN');
    try {
      const updated = this.db.prepare("UPDATE events SET status='complete', analysis=?, error=NULL, updated_at=? WHERE id=? AND status IN ('pending','processing')")
        .run(JSON.stringify(analysis), new Date().toISOString(), id);
      if (updated.changes) this.saveKnowledge(id, analysis);
      this.db.exec('COMMIT');
      return updated.changes > 0;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  fail(id, error) {
    this.db.prepare("UPDATE events SET status='failed', error=?, updated_at=? WHERE id=? AND status IN ('pending','processing')")
      .run(String(error).slice(0, 260), new Date().toISOString(), id);
  }
  retry(id) {
    const result = this.db.prepare("UPDATE events SET status='pending', error=NULL, updated_at=? WHERE id=? AND status IN ('failed','cancelled')")
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }
  cancel(id) {
    return this.db.prepare("UPDATE events SET status='cancelled', error=NULL, updated_at=? WHERE id=? AND status IN ('pending','processing')")
      .run(new Date().toISOString(), id).changes > 0;
  }
  delete(id, { purgeKnowledge = false } = {}) {
    this.db.exec('BEGIN');
    try {
      const links = this.db.prepare('SELECT knowledge_id FROM event_knowledge WHERE event_id=?').all(id);
      if (!purgeKnowledge) {
        for (const link of links) this.db.prepare('UPDATE knowledge SET retained_encounters=retained_encounters+1 WHERE id=?').run(link.knowledge_id);
      }
      this.db.prepare('DELETE FROM event_knowledge WHERE event_id=?').run(id);
      this.db.prepare('UPDATE favorites SET event_id=NULL WHERE event_id=?').run(id);
      const removed = this.db.prepare('DELETE FROM events WHERE id=?').run(id).changes > 0;
      for (const link of links) {
        this.db.prepare(`UPDATE knowledge SET encounters=retained_encounters +
          (SELECT COUNT(*) FROM event_knowledge WHERE knowledge_id=knowledge.id),
          last_seen=COALESCE((SELECT MAX(e.updated_at) FROM events e JOIN event_knowledge ek ON ek.event_id=e.id WHERE ek.knowledge_id=knowledge.id), last_seen)
          WHERE id=?`).run(link.knowledge_id);
        this.db.prepare('DELETE FROM knowledge WHERE id=? AND encounters=0').run(link.knowledge_id);
      }
      this.db.exec('COMMIT');
      return removed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveKnowledge(eventId, analysis, timestamp = new Date().toISOString()) {
    const items = [];
    const example = value => {
      if (value && typeof value === 'object') items.push({ term: value.english, meaning: value.chinese, category: 'example', primary: 0 });
    };
    for (const value of rows(analysis.vocabulary)) {
      if (!value || typeof value !== 'object') continue;
      items.push({ term: value.term, meaning: value.meaning, category: 'vocabulary', primary: 1 });
      for (const valueExample of rows(value.examples)) example(valueExample);
      for (const sense of rows(value.senses)) example(sense?.example);
      for (const field of ['wordFamily', 'synonyms', 'antonyms']) {
        for (const related of rows(value[field])) {
          if (!related || typeof related !== 'object') continue;
          items.push({ term: related.term, meaning: related.meaning, category: 'vocabulary', primary: 0 });
          example(related.example);
        }
      }
    }
    for (const grammar of rows(analysis.grammar)) {
      if (grammar && typeof grammar === 'object') items.push({ term: grammar.label, meaning: grammar.explanation, category: 'grammar', primary: 1 });
    }
    for (const value of rows(analysis.examples)) example(value);
    for (const item of items) {
      const term = safeText(item.term).slice(0, 1200), meaning = safeText(item.meaning).slice(0, 3000);
      if (!term || !meaning) continue;
      const id = itemId(item.category, term);
      this.db.prepare(`INSERT INTO knowledge(id, term, meaning, category, encounters, last_seen, is_primary)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          meaning=CASE WHEN excluded.last_seen >= knowledge.last_seen THEN excluded.meaning ELSE knowledge.meaning END,
          last_seen=MAX(knowledge.last_seen,excluded.last_seen), is_primary=MAX(knowledge.is_primary,excluded.is_primary)`)
        .run(id, term, meaning, item.category, timestamp, item.primary);
      const link = this.db.prepare('INSERT OR IGNORE INTO event_knowledge(event_id, knowledge_id) VALUES (?, ?)')
        .run(eventId, id);
      if (link.changes) this.db.prepare('UPDATE knowledge SET encounters=encounters+1 WHERE id=?').run(id);
    }
  }
  listKnowledge(limit = 100) {
    return this.db.prepare(`SELECT id,term,meaning,category,encounters,last_seen,retained_encounters FROM knowledge
      WHERE is_primary=1 AND category IN ('vocabulary','grammar') ORDER BY last_seen DESC LIMIT ?`)
      .all(Math.min(Math.max(Number(limit) || 100, 1), 200));
  }
  stats() {
    const row = this.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN status='pending' OR status='processing' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
      FROM events`).get();
    return {
      total: Number(row.total), complete: Number(row.complete),
      pending: Number(row.pending), failed: Number(row.failed),
      knowledge: Number(this.db.prepare("SELECT COUNT(*) AS n FROM knowledge WHERE is_primary=1 AND category IN ('vocabulary','grammar')").get().n),
      favorites: Number(this.db.prepare('SELECT COUNT(*) AS n FROM favorites').get().n),
      sources: this.db.prepare('SELECT source, COUNT(*) AS count FROM events GROUP BY source ORDER BY count DESC').all(),
    };
  }
  close() { this.db.close(); }
}
