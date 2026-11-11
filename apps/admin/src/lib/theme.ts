'use client';

export type ThemePref = 'light' | 'dark' | 'system';


export function applyTheme(t: ThemePref) {
  const root = document.documentElement;
  if (t === 'system') {
    delete root.dataset.theme;
    document.cookie = 'sw_theme=; Path=/; Max-Age=0; SameSite=Lax';
  } else {
    root.dataset.theme = t;
    document.cookie = `sw_theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
}
