import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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
    this.db.prepare("UPDATE events SET status='pending' WHERE status='processing'").run();
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
  saveKnowledge(eventId, analysis) {
    const items = [
      ...(analysis.vocabulary || []).map(v => ({ term: v.term, meaning: v.meaning, category: 'vocabulary' })),
      ...(analysis.grammar || []).map(g => ({ term: g.label, meaning: g.explanation, category: 'grammar' })),
    ];
    for (const item of items) {
      if (!item.term || !item.meaning) continue;
      const normalized = `${item.category}:${item.term.trim().toLowerCase()}`;
      const id = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
      this.db.prepare(`INSERT INTO knowledge(id, term, meaning, category, encounters, last_seen)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO UPDATE SET meaning=excluded.meaning, last_seen=excluded.last_seen`)
        .run(id, item.term.trim().slice(0, 140), item.meaning.slice(0, 300), item.category, new Date().toISOString());
      const link = this.db.prepare('INSERT OR IGNORE INTO event_knowledge(event_id, knowledge_id) VALUES (?, ?)')
        .run(eventId, id);
      if (link.changes) this.db.prepare('UPDATE knowledge SET encounters=encounters+1 WHERE id=?').run(id);
    }
  }
  listKnowledge(limit = 100) {
    return this.db.prepare('SELECT * FROM knowledge ORDER BY last_seen DESC LIMIT ?').all(Math.min(limit, 200));
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
      knowledge: Number(this.db.prepare('SELECT COUNT(*) AS n FROM knowledge').get().n),
      sources: this.db.prepare('SELECT source, COUNT(*) AS count FROM events GROUP BY source ORDER BY count DESC').all(),
    };
  }
  close() { this.db.close(); }
}
