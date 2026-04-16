import { useState } from 'react';
import { RequestLogsTab } from './RequestLogsTab.js';
import { FileLogsTab } from './FileLogsTab.js';

type Tab = 'requests' | 'app' | 'error';

const TABS: { id: Tab; label: string }[] = [
  { id: 'requests', label: 'Recent Requests' },
  { id: 'app', label: 'App Log' },
  { id: 'error', label: 'Error Log' },
];

export function LogsPage() {
  const [tab, setTab] = useState<Tab>('requests');

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex gap-1 border-b border-slate-700/60">
        {TABS.map(({ id, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                active
                  ? 'text-blue-400 border-blue-400'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'requests' && <RequestLogsTab />}
      {tab === 'app' && <FileLogsTab key="app" type="app" />}
      {tab === 'error' && <FileLogsTab key="error" type="error" />}
    </div>
  );
}
