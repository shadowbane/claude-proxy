interface HeaderProps {
  title: string;
  onMenuToggle: () => void;
}

export function Header({ title, onMenuToggle }: HeaderProps) {
  return (
    <header className="h-14 bg-slate-800/80 backdrop-blur border-b border-slate-700/60 flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="md:hidden p-1.5 rounded-md hover:bg-slate-700 text-slate-400 transition-colors"
          aria-label="Toggle menu"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
      </div>
    </header>
  );
}
