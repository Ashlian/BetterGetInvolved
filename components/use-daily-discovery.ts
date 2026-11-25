'use client';

import {useEffect, useMemo, useState} from 'react';
import {dateKey, type Club, type Recommendation, type Saved} from '@/lib/api';
import type {DeckAction} from './discover-deck';

type Entry = Pick<Recommendation, 'id' | 'explanation' | 'reasons' | 'tags'>;
type DailyRecord = {day: string; entries: Entry[]; outcomes: Partial<Record<string, DeckAction>>};
type DailySession = {key: string; day: string; record: DailyRecord | null};
const LIMIT = 5;

function readDaily(key: string, day: string): DailyRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as DailyRecord | null;
    if (!value || value.day !== day || !Array.isArray(value.entries) || !value.outcomes || typeof value.outcomes !== 'object') return null;
    const entries = value.entries.filter(item => item && typeof item.id === 'string' && typeof item.explanation === 'string'
      && (!item.tags || Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string'))
      && (!item.reasons || Array.isArray(item.reasons) && item.reasons.every(reason => typeof reason === 'string'))).slice(0, LIMIT);
    const unique = [...new Map(entries.map(item => [item.id, item])).values()];
    const outcomes = Object.fromEntries(unique.flatMap(({id}) => {
      const action = value.outcomes[id];
      return action === 'pass' || action === 'save' || action === 'follow' ? [[id, action]] : [];
    }));
    return unique.length ? {day, entries: unique, outcomes} : null;
  } catch {
    return null;
  }
}

function writeDaily(key: string, record: DailyRecord) {
  try {localStorage.setItem(key, JSON.stringify(record));} catch {
    // Keep the current session usable when the browser blocks storage.
  }
}

export function useDailyDiscovery(account: string | undefined, now: number, ranked: Recommendation[] | undefined, clubs: Club[], saved: Saved, ready: boolean) {
  const day = dateKey(new Date(now).toISOString());
  const key = account ? `bgi.daily.v1.${encodeURIComponent(account)}` : '';
  const [session, setSession] = useState<DailySession | null>(null);
  const current = session?.key === key && session.day === day ? session : null;
  const record = current?.record;
  const excluded = useMemo(() => new Set([...saved.club_ids, ...saved.dismissed_ids, ...(saved.maybe_later_ids ?? [])]), [saved]);
  const catalog = useMemo(() => new Map(clubs.map(club => [club.id, club])), [clubs]);

  useEffect(() => {
    if (!key || !ready) return;
    function restore() {
      setSession({key, day, record: readDaily(key, day)});
    }
    restore();
    function sync(event: StorageEvent) {
      if (event.key === key || event.key === null) restore();
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key, day, ready]);

  useEffect(() => {
    if (!current || record || !ranked) return;
    const entries = [...new Map(ranked
      .filter(club => !excluded.has(club.id) && catalog.has(club.id))
      .map(({id, explanation, reasons, tags}) => [id, {id, explanation, reasons, tags}])).values()].slice(0, LIMIT);
    if (!entries.length) return;
    const latest = readDaily(key, day) ?? {day, entries, outcomes: {}};
    writeDaily(key, latest);
    setSession({key, day, record: latest});
  }, [catalog, current, day, excluded, key, ranked, record]);

  function recordAction(id: string, action: DeckAction) {
    if (!record?.entries.some(entry => entry.id === id) || dateKey(new Date().toISOString()) !== day) return;
    const latest = readDaily(key, day) ?? record;
    const next = {...latest, outcomes: {...latest.outcomes, [id]: latest.outcomes[id] ?? action}};
    writeDaily(key, next);
    setSession(previous => previous?.key === key && previous.day === day ? {key, day, record: next} : previous);
  }

  const remaining = (record?.entries ?? []).flatMap(entry => {
    const club = catalog.get(entry.id);
    if (!club || excluded.has(entry.id) || record?.outcomes[entry.id]) return [];
    // Club details come from the current catalog. Only the day's backend explanations are frozen.
    return [{...club, ...entry}];
  });
  const entries = record?.entries ?? [];
  const outcomes = record?.outcomes ?? {};
  const explored = entries.filter(entry => outcomes[entry.id]);
  const categories = [...new Set(explored.flatMap(({id}) => {
    const category = catalog.get(id)?.category;
    return category ? [category] : [];
  }))];

  return {
    day, loaded: !!current, recordAction, remaining, total: entries.length,
    explored: explored.length, followed: explored.filter(({id}) => outcomes[id] === 'follow').length,
    bookmarked: explored.filter(({id}) => outcomes[id] === 'save').length,
    unavailable: entries.length - explored.length - remaining.length, categories,
  };
}

export type DailyDiscoveryState = ReturnType<typeof useDailyDiscovery>;
