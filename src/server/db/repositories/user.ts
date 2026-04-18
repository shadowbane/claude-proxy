// User repository — CRUD for API consumer accounts
import { getDb } from '../connection.js';
import type { User, UserCreate, UserUpdate } from '../../../shared/types.js';

export function listUsers(): User[] {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
}

export function getUserById(id: string): User | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function createUser(data: UserCreate, createdBy: string): User {
  const stmt = getDb().prepare(
    `INSERT INTO users (name, email, enabled, daily_token_quota, credit_limit, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    data.name,
    data.email ?? null,
    data.enabled === false ? 0 : 1,
    data.daily_token_quota ?? null,
    data.credit_limit ?? null,
    createdBy,
  ) as User;
}

export function updateUser(id: string, data: UserUpdate): User | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.email !== undefined) {
    fields.push('email = ?');
    values.push(data.email);
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(data.enabled ? 1 : 0);
  }
  if (data.daily_token_quota !== undefined) {
    fields.push('daily_token_quota = ?');
    values.push(data.daily_token_quota);
  }
  if (data.credit_limit !== undefined) {
    fields.push('credit_limit = ?');
    values.push(data.credit_limit);
  }

  if (fields.length === 0) return getUserById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  return getDb()
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
    .get(...values) as User | undefined;
}

export function deleteUser(id: string): boolean {
  const result = getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}
