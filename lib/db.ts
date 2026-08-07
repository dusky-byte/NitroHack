import Database from 'better-sqlite3';
import path from 'path';

// Connect to a local SQLite database in the root of the project
const dbPath = path.resolve(process.cwd(), 'nitrohack.db');
export const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    title TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    port TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export function addActivity(tag: string, title: string) {
  const stmt = db.prepare('INSERT INTO activities (tag, title) VALUES (?, ?)');
  stmt.run(tag, title);
}

export function getActivities(limit = 50) {
  const stmt = db.prepare('SELECT * FROM activities ORDER BY timestamp DESC LIMIT ?');
  return stmt.all(limit);
}

export function logConnection(ip: string, port: string, status: string) {
  const stmt = db.prepare('INSERT INTO connections (ip, port, status) VALUES (?, ?, ?)');
  stmt.run(ip, port, status);
}
