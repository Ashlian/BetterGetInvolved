export type Club = {
  id: string; name: string; short_name: string; category: string; description: string; mission: string;
  interests: string[]; campus: string; location: string; meeting_schedule: string; beginner_friendly: boolean;
  membership_fee: string; eligibility: string; contact_email: string; website: string; instagram?: string;
  discord?: string; faqs: {question: string; answer: string}[]; source_url: string; updated_at: string;
  verification: 'demo' | 'unclaimed' | 'verified'; color: string; featured: boolean;
};
export type Recommendation = Club & {score: number; explanation: string};
export type CampusEvent = {
  id: string; club_id: string; club_name: string; title: string; description: string; starts_at: string;
  ends_at: string | null; campus: string; location: string; category: string; cost: number | null;
  beginner_friendly: boolean; registration_url: string; accessibility: string; source_url: string;
  updated_at: string; status: 'scheduled' | 'cancelled'; is_demo: boolean;
  /** Real Rutgers listing from the Scarlet Sync feed; no description or end time is guaranteed. */
  live?: boolean; source?: string; image_url?: string | null;
};
export type LiveStatus = {synced_at: string | null; count: number; error: string | null; source: string; source_url: string};
export type User = {
  id: string; email: string; display_name: string; role: 'student' | 'officer' | 'admin';
  interests: string[]; goals: string; campus: string; onboarded: boolean;
};
export type Saved = {club_ids: string[]; event_ids: string[]; dismissed_ids: string[]; maybe_later_ids?: string[]; rsvps?: Record<string, 'going' | 'interested'>; live_events?: CampusEvent[]};
export type Answer = {answer: string; sources: {title: string; url: string; excerpt: string}[]; supported: boolean; method: string};
export type Analytics = {clubs: {club_id: string; name: string; follows: number; saved_events: number; rsvps: number; events: number}[]; note: string};
export type ForumPost = {
  id: string;
  club_id: string;
  club_name: string;
  title: string;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  comment_count: number;
  can_delete: boolean;
};
export type ForumComment = {
  id: string;
  post_id: string;
  body: string;
  author_name: string;
  created_at: string;
  can_delete: boolean;
};
export type ForumThread = ForumPost & {comments: ForumComment[]};

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include', ...options,
    headers: {'Content-Type': 'application/json', ...options?.headers},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : body.detail ? 'Please check the fields and try again.' : `Request failed (${response.status}). Please try again.`;
    throw new Error(detail);
  }
  return response.json();
}
export const post = <T,>(path: string, body?: unknown) => api<T>(path, {method: 'POST', body: body === undefined ? undefined : JSON.stringify(body)});
export const put = <T,>(path: string, body: unknown) => api<T>(path, {method: 'PUT', body: JSON.stringify(body)});
export const cleanName = (name: string) => name.replace(/\s*\(Demo\)\s*$/i, '');
export const dateFormat = (date: string | Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', ...options}).format(new Date(date));
export const dateKey = (date: string) => dateFormat(date, {year: 'numeric', month: '2-digit', day: '2-digit'});
export const eventTime = (date: string) => dateFormat(date, {hour: 'numeric', minute: '2-digit'});
export const REFERENCE_DATE = '2026-10-22T12:00:00-04:00';
/** Overlap checks treat an event with no listed end as a one-hour block. */
export const eventEnd = (event: CampusEvent) => event.ends_at ? Date.parse(event.ends_at) : Date.parse(event.starts_at) + 60 * 60 * 1000;
export const overlaps = (a: CampusEvent, b: CampusEvent) => a.status !== 'cancelled' && b.status !== 'cancelled' && Date.parse(a.starts_at) < eventEnd(b) && Date.parse(b.starts_at) < eventEnd(a);
export const timeRange = (event: CampusEvent) => event.ends_at ? `${eventTime(event.starts_at)} – ${eventTime(event.ends_at)}` : `Starts ${eventTime(event.starts_at)}`;
export const costLabel = (event: CampusEvent) => event.cost === 0 ? 'Free' : event.cost === null ? 'Cost not listed' : `$${event.cost.toFixed(2)}`;
export function relativeTime(iso: string) {const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000); return minutes < 2 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : dateFormat(iso, {month: 'short', day: 'numeric'});}
export const CAMPUSES = ['College Avenue', 'Busch', 'Livingston', 'Cook', 'Douglass'];
export const INTERESTS = ['Technology', 'Arts & Music', 'Volunteering', 'Entrepreneurship', 'Culture', 'Science', 'Outdoors', 'Wellbeing', 'Gaming', 'Professional growth'];
