import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUsers } from '@/hooks/useUsers.js';
import { AddUserModal } from './AddUserModal.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import type { User, UserCreate } from '@shared/types';

function formatDate(value: string | null): string {
  if (!value) return 'never';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function UsersPage() {
  const { users, loading, error, addUser, deleteUser, toggleEnabled } = useUsers();
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (data: UserCreate) => {
    await addUser(data);
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div />
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          + Add User
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/60 text-red-300 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {loading && <p className="text-slate-500 text-sm">Loading...</p>}

      {!loading && users.length === 0 && (
        <div className="text-center py-20">
          <h3 className="text-lg font-medium text-slate-300 mb-2">No users yet</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
            Create your first API user to start proxying requests.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            Create First User
          </button>
        </div>
      )}

      {!loading && users.length > 0 && (
        <div className="bg-slate-800 border border-slate-700/60 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-left px-4 py-3 font-medium">Quota</th>
                  <th className="text-center px-4 py-3 font-medium">Enabled</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-800/60">
                    <td
                      className="px-4 py-3 cursor-pointer group hover:bg-slate-700/40 transition-colors"
                      onClick={() => navigate(`/users/${user.id}`)}
                    >
                      <div className="flex items-center gap-1.5 text-slate-200 font-medium truncate group-hover:text-blue-400 transition-colors">
                        <span className="truncate">{user.name}</span>
                        <span className="text-slate-500 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          &rarr;
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {user.email || <span className="text-slate-600">&mdash;</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {user.daily_token_quota === null
                        ? <span className="text-slate-600">Default</span>
                        : user.daily_token_quota === -1
                          ? <span className="text-slate-400">Unlimited</span>
                          : new Intl.NumberFormat().format(user.daily_token_quota)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleEnabled(user.id, !user.enabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          user.enabled ? 'bg-green-500' : 'bg-slate-600'
                        }`}
                        aria-label={user.enabled ? 'Disable' : 'Enable'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                            user.enabled ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPendingDelete(user)}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete User"
        message={`Delete "${pendingDelete?.name ?? ''}"? All tokens for this user will also be deleted. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await deleteUser(pendingDelete.id);
            setPendingDelete(null);
          }
        }}
      />
    </div>
  );
}
