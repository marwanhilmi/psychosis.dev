import { useState, useMemo, useCallback } from 'react'

export interface RepoItem {
  id: string | number
  fullName: string
  language: string | null
  stars: number
  pushedAt: string
  selected: boolean
}

const DEFAULT_MAX_SELECTION = 10

interface RepoPickerProps {
  repos: RepoItem[]
  onConfirm: (selected: RepoItem[]) => void
  loading?: boolean
  maxSelection?: number
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  PHP: '#4F5D95',
  Lua: '#000080',
  Zig: '#ec915c',
}

export function RepoPicker({ repos, onConfirm, loading, maxSelection = DEFAULT_MAX_SELECTION }: RepoPickerProps) {
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<Set<string | number>>(() => {
    return new Set(repos.filter((r) => r.selected).map((r) => r.id))
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return repos
    const q = search.toLowerCase()
    return repos.filter(
      (r) => r.fullName.toLowerCase().includes(q) || (r.language && r.language.toLowerCase().includes(q)),
    )
  }, [repos, search])

  const toggle = useCallback(
    (id: string | number) => {
      setSelection((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          if (maxSelection && next.size >= maxSelection) return prev
          next.add(id)
        }
        return next
      })
    },
    [maxSelection],
  )

  const selectAll = useCallback(() => {
    const ids = filtered.map((r) => r.id)
    if (maxSelection) {
      setSelection(new Set(ids.slice(0, maxSelection)))
    } else {
      setSelection(new Set(ids))
    }
  }, [filtered, maxSelection])

  const selectNone = useCallback(() => {
    setSelection(new Set())
  }, [])

  const handleConfirm = useCallback(() => {
    const selected = repos.filter((r) => selection.has(r.id))
    onConfirm(selected)
  }, [repos, selection, onConfirm])

  const timeAgo = (date: string) => {
    const ms = Date.now() - new Date(date).getTime()
    const days = Math.floor(ms / 86400000)
    if (days < 1) return 'today'
    if (days === 1) return '1d ago'
    if (days < 30) return `${days}d ago`
    if (days < 365) return `${Math.floor(days / 30)}mo ago`
    return `${Math.floor(days / 365)}y ago`
  }

  return (
    <div className="w-full max-w-2xl">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold tracking-wider text-[#666] uppercase">
          Select Repos to Analyze
          <span className="ml-2 text-[var(--ultra-orange)]">
            {selection.size}
            {maxSelection ? `/${maxSelection}` : ''}
          </span>
        </h2>
        <div className="flex gap-3">
          <button
            onClick={selectAll}
            className="font-mono text-[10px] tracking-wider text-[#555] uppercase transition-colors hover:text-[var(--ultra-orange)]"
          >
            All
          </button>
          <button
            onClick={selectNone}
            className="font-mono text-[10px] tracking-wider text-[#555] uppercase transition-colors hover:text-[var(--ultra-orange)]"
          >
            None
          </button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter repos..."
        className="mb-2 w-full rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-3 py-1.5 font-mono text-xs text-[var(--milk)] placeholder-[#444] outline-none transition-colors focus:border-[var(--ultra-orange)]"
      />

      {/* Repo list */}
      <div className="max-h-72 overflow-y-auto rounded-sm border-2 border-[var(--eyelash)] bg-[#0a0a0a]">
        {filtered.length === 0 ? (
          <div className="p-4 text-center font-mono text-xs text-[#444]">No repos found</div>
        ) : (
          filtered.map((repo) => {
            const isSelected = selection.has(repo.id)
            const langColor = repo.language ? (LANG_COLORS[repo.language] ?? '#666') : undefined
            const [owner, name] = repo.fullName.split('/')
            return (
              <button
                key={repo.id}
                onClick={() => toggle(repo.id)}
                className={`flex w-full items-center gap-2 border-b border-[#1a1a1a] px-3 py-2 text-left transition-colors last:border-b-0 ${
                  isSelected ? 'bg-[var(--ultra-orange)]/5' : 'hover:bg-[#111]'
                }`}
              >
                {/* Checkbox */}
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2 transition-colors ${
                    isSelected ? 'border-[var(--ultra-orange)] bg-[var(--ultra-orange)]' : 'border-[#333]'
                  }`}
                >
                  {isSelected && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#000"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>

                {/* Repo name */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-[var(--milk)]">{name ?? repo.fullName}</span>
                  {owner && <span className="block truncate font-mono text-[9px] text-[#555]">{owner}</span>}
                </span>

                {/* Language dot */}
                {repo.language && (
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: langColor }} />
                    <span className="font-mono text-[9px] text-[#555]">{repo.language}</span>
                  </span>
                )}

                {/* Stars */}
                {repo.stars > 0 && (
                  <span className="shrink-0 font-mono text-[9px] text-[#444]">
                    {repo.stars > 999 ? `${(repo.stars / 1000).toFixed(1)}k` : repo.stars}
                  </span>
                )}

                {/* Pushed date */}
                <span className="hidden shrink-0 font-mono text-[9px] text-[#333] sm:inline">
                  {timeAgo(repo.pushedAt)}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Cap notice */}
      {selection.size >= maxSelection && (
        <p className="mt-2 font-mono text-[10px] tracking-wider text-[#555]">
          Max {maxSelection} repos — deselect one to swap
        </p>
      )}

      {/* Confirm */}
      <button
        onClick={handleConfirm}
        disabled={selection.size === 0 || loading}
        className={`mt-4 w-full rounded-sm border-2 px-6 py-3 font-mono text-sm font-bold tracking-wider uppercase transition-all ${
          selection.size > 0 && !loading
            ? 'border-[var(--ultra-orange)] bg-[var(--ultra-orange)]/10 text-[var(--ultra-orange)] hover:bg-[var(--ultra-orange)] hover:text-black hover:shadow-[0_0_30px_rgba(255,79,0,0.3)]'
            : 'cursor-not-allowed border-[#222] text-[#444]'
        }`}
      >
        {loading
          ? 'Analyzing...'
          : selection.size === 0
            ? 'Select repos to continue'
            : `Analyze ${selection.size} repo${selection.size === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}
