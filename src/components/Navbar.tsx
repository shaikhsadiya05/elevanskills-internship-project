"use client";

import React, { useEffect, useId, useState } from 'react';
import { Film, Search, Menu, X, Sun, Moon, Contrast, Monitor } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import { parseThemePreference } from '../lib/theme/theme';
import { addRecentSearch, clearRecentSearches, readRecentSearches } from '../lib/movies/search-history';

function ThemeControl({ compact = false }: { compact?: boolean }) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const id = useId();
  const reduceMotion = useReducedMotion();
  const Icon = preference === 'system' ? Monitor : resolvedTheme === 'light' ? Sun : resolvedTheme === 'high-contrast' ? Contrast : Moon;

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={preference === 'system' ? 'system' : resolvedTheme} aria-hidden="true" initial={{ opacity: 0, rotate: reduceMotion ? 0 : -25, scale: 0.85 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: reduceMotion ? 0 : 25, scale: 0.85 }} transition={{ duration: reduceMotion ? 0 : 0.16 }}>
          <Icon className="h-4 w-4 text-yellow-500" />
        </motion.span>
      </AnimatePresence>
      <label className="sr-only" htmlFor={id}>Color theme</label>
      <select id={id} aria-label="Color theme" className={`rounded border border-zinc-700 bg-zinc-950 text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-500 ${compact ? 'max-w-28 px-2 py-2 text-xs' : 'px-2 py-1.5 text-sm'}`} onChange={(event) => {
        const next = parseThemePreference(event.target.value);
        if (next) setPreference(next);
      }} value={preference}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="high-contrast">High Contrast</option>
      </select>
    </div>
  );
}

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isSearchHistoryOpen, setIsSearchHistoryOpen] = useState(false);
  const searchHistoryId = useId();
  const router = useRouter();

  useEffect(() => {
    setRecentSearches(readRecentSearches());
  }, []);

  const submitSearch = (search: string) => {
    const query = search.trim();
    if (!query) return;
    setRecentSearches(addRecentSearch(query));
    setIsSearchHistoryOpen(false);
    setIsMenuOpen(false);
    router.push(`/movies?search=${encodeURIComponent(query)}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    submitSearch(searchQuery);
  };

  const searchHistory = (id: string, compact = false) => isSearchHistoryOpen && recentSearches.length > 0 && (
    <div
      id={id}
      aria-label="Recent searches"
      className={`absolute left-0 top-full z-[60] mt-2 w-full min-w-64 rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-100 shadow-xl ${compact ? 'min-w-0' : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      role="group"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Recent searches</span>
        <button
          className="text-xs text-zinc-400 underline underline-offset-2 hover:text-yellow-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400"
          onClick={() => {
            clearRecentSearches();
            setRecentSearches([]);
            setIsSearchHistoryOpen(false);
          }}
          type="button"
        >
          Clear
        </button>
      </div>
      <ul>
        {recentSearches.map((search) => (
          <li key={search}>
            <button
              className="w-full rounded px-2 py-2 text-left text-sm hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400"
              onClick={() => {
                setSearchQuery(search);
                submitSearch(search);
              }}
              type="button"
            >
              {search}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const navItems = [
    { label: 'Movies', path: '/movies' },
    { label: 'Watchlist', path: '/watchlist' },
    { label: 'Top Rated', path: '/top-rated' },
    { label: 'Coming Soon', path: '/movies?sort=upcoming' },
  ];

  return (
    <nav className="bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 hover-glow">
            <Film className="w-8 h-8 text-yellow-500" />
            <span className="text-xl font-bold text-glow">MovieDB</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-zinc-400 w-5 h-5" />
              <input
                type="text"
                aria-controls={`${searchHistoryId}-mobile`}
                aria-label="Search movies"
                autoComplete="off"
                value={searchQuery}
                onFocus={() => setIsSearchHistoryOpen(true)}
                onBlur={() => setIsSearchHistoryOpen(false)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search movies..."
                className="bg-zinc-950/80 backdrop-blur-md text-zinc-100 pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-500/50 w-64 transition-all"
              />
              {searchHistory(searchHistoryId)}
            </form>
            <div className="flex items-center gap-6">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.path}
                  className="text-zinc-300 hover:text-white transition-colors hover-glow"
                >
                  {item.label}
                </Link>
              ))}
              <ThemeControl />
            </div>
          </div>

          <div className="flex items-center gap-3 md:hidden">
            <ThemeControl compact />
            <button aria-label={isMenuOpen ? 'Close menu' : 'Open menu'} className="text-zinc-300 hover:text-zinc-950" onClick={() => setIsMenuOpen(!isMenuOpen)} type="button">
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="md:hidden py-4">
            <div className="flex flex-col gap-4">
              <form onSubmit={handleSearch} className="relative">
                <Search className="bg-white absolute left-3 top-1/2 transform -translate-y-1/2 text-yellow-600 w-5 h-5" />
                <input
                  type="text"
                  aria-controls={searchHistoryId}
                  aria-label="Search movies"
                  autoComplete="off"
                  value={searchQuery}
                  onFocus={() => setIsSearchHistoryOpen(true)}
                  onBlur={() => setIsSearchHistoryOpen(false)}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search movies..."
                  className="bg-zinc-950/80 backdrop-blur-md text-zinc-100 pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-500/50 w-full"
                />
                {searchHistory(`${searchHistoryId}-mobile`, true)}
              </form>
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.path}
                  className="text-zinc-300 hover:text-white transition-colors py-2"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;