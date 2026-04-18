import { useState } from 'react';
import { GeneralTab } from './GeneralTab.js';
import { QuotasTab } from './QuotasTab.js';
import { MaintenanceTab } from './MaintenanceTab.js';
import { AccountTab } from './AccountTab.js';

type Tab = 'general' | 'quotas' | 'maintenance' | 'account';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'quotas', label: 'Quotas' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'account', label: 'Account' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');

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

      <div className="max-w-2xl space-y-6">
        {tab === 'general' && <GeneralTab />}
        {tab === 'quotas' && <QuotasTab />}
        {tab === 'maintenance' && <MaintenanceTab />}
        {tab === 'account' && <AccountTab />}
      </div>
    </div>
  );
}
