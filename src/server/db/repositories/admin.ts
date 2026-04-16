// Admin repository — CRUD for dashboard admin accounts
import { getDb } from '../connection.js';
import type { Admin } from '../../../shared/types.js';

export function getAdminByUsername(username: string): Admin | undefined {
  return getDb().prepare('SELECT * FROM admins WHERE username = ?').get(username) as Admin | undefined;
}

export function getAdminById(id: string): Admin | undefined {
  return getDb().prepare('SELECT * FROM admins WHERE id = ?').get(id) as Admin | undefined;
}

export function createAdmin(username: string, passwordHash: string): Admin {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO admins (username, password_hash) VALUES (?, ?) RETURNING *`,
  );
  return stmt.get(username, passwordHash) as Admin;
}

export function updateAdminPassword(id: string, passwordHash: string): void {
  getDb()
    .prepare(`UPDATE admins SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(passwordHash, id);
}

export function countAdmins(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  return row.count;
}
