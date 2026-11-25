'use client';
import {useEffect, useRef, useState} from 'react';
import {useServerInsertedHTML} from 'next/navigation';
import {Monitor, Moon, Sun} from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'bgi.theme';
const PAGE = {light: '#ffffff', dark: '#0f0f10'};

// Runs while the page is parsed, before anything is painted, so a saved dark theme never flashes white.
const SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}`;

export function ThemeScript() {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script id="theme-script" dangerouslySetInnerHTML={{__html: SCRIPT}}/>;
  });
  return null;
}

function readTheme(): Theme {
  try {const stored = localStorage.getItem(KEY); if (stored === 'dark' || stored === 'system') return stored;} catch {}
  return 'light';
}

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? PAGE.dark : PAGE.light);
}

/** Light (the default), dark, or whatever the device uses. Kept in this browser only. */
export function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const sync = () => {const next = readTheme(); setTheme(next); applyTheme(next);};
    sync();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync); window.addEventListener('storage', sync);
    return () => {media.removeEventListener('change', sync); window.removeEventListener('storage', sync);};
  }, []);
  function choose(next: Theme) {
    setTheme(next); applyTheme(next);
    try {localStorage.setItem(KEY, next);} catch {}
  }
  const Icon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;
  return <label className="top-control theme-control" title="Theme"><Icon size={17} aria-hidden="true"/><select aria-label="Theme" value={theme} onChange={e => choose(e.target.value as Theme)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>;
}
