'use client';
import {useEffect, useState, type FormEvent} from 'react';
import {ArrowUpRight, BarChart3, CalendarDays, Check, Edit3, Eye, Heart, Plus, RefreshCw, Users} from 'lucide-react';
import {api, post, put, CAMPUSES, cleanName, dateFormat, type Club, type CampusEvent, type Analytics} from '@/lib/api';
import Dialog from './dialog';
import {ErrorMessage, SubmitButton} from './account';

function easternInput(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
function easternISO(local: string) {
  const approximate = new Date(`${local}:00Z`).getTime();
  const matches = [-4, -5].map(offset => new Date(approximate - offset * 60 * 60 * 1000).toISOString()).filter(candidate => easternInput(candidate) === local);
  if (!matches.length) throw new Error('This Eastern Time does not exist during the daylight saving change. Please choose a different time.');
  if (matches.length > 1) throw new Error('This Eastern Time occurs twice during the daylight saving change. Please choose a time before 1:00 AM or after 2:00 AM.');
  return matches[0];
}

function EventEditor({clubs, event, onClose, onSaved}: {clubs: Club[]; event: CampusEvent | null; onClose: () => void; onSaved: () => void}) {
  const [clubId, setClubId] = useState(event?.club_id || clubs[0]?.id || ''); const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || ''); const [starts, setStarts] = useState(event ? easternInput(event.starts_at) : '2026-10-29T18:00'); const [ends, setEnds] = useState(event ? easternInput(event.ends_at) : '2026-10-29T19:30');
  const [campus, setCampus] = useState(event?.campus || clubs[0]?.campus || CAMPUSES[0]); const [location, setLocation] = useState(event?.location || ''); const [category, setCategory] = useState(event?.category || clubs[0]?.category || '');
  const [cost, setCost] = useState(event?.cost || 0); const [beginner, setBeginner] = useState(event?.beginner_friendly ?? true); const [url, setUrl] = useState(event?.registration_url || ''); const [accessibility, setAccessibility] = useState(event?.accessibility || '');
  const [status, setStatus] = useState(event?.status || 'scheduled'); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    if (new Date(ends) <= new Date(starts)) {setError('End time must be after the start time.'); return;}
    setLoading(true);
    try {
      const payload = {club_id: clubId, title, description, starts_at: easternISO(starts), ends_at: easternISO(ends), campus, location, category, cost, beginner_friendly: beginner, registration_url: url, accessibility, ...(event ? {status} : {})};
      if (event) await api(`/officer/events/${event.id}`, {method: 'PATCH', body: JSON.stringify(payload)}); else await post('/officer/events', payload);
      onSaved();
    } catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }
  return <Dialog title={event ? 'Edit your event' : 'Bring people together'} wide onClose={onClose}><p className="dialog-description">Publish a demo event for your assigned club. Dates and times use America/New_York.</p><form className="form-stack" onSubmit={submit}>
    <label>Club<select required disabled={!!event} value={clubId} onChange={e => {setClubId(e.target.value); const club = clubs.find(c => c.id === e.target.value); if (club) {setCampus(club.campus); setCategory(club.category);}}}>{clubs.map(c => <option value={c.id} key={c.id}>{cleanName(c.name)}</option>)}</select></label>
    <label>Event title<input value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={150} placeholder="Give your next gathering a name"/></label><label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} required minLength={10} maxLength={5000} rows={4} placeholder="What will people do? What should they bring?"/></label>
    <div className="form-columns"><label>Starts (Eastern Time)<input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} required/></label><label>Ends (Eastern Time)<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} required/></label></div>
    <div className="form-columns"><label>Campus<select value={campus} onChange={e => setCampus(e.target.value)}>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select></label><label>Location<input value={location} onChange={e => setLocation(e.target.value)} required maxLength={200} placeholder="Building and room"/></label></div>
    <div className="form-columns"><label>Category<input value={category} onChange={e => setCategory(e.target.value)} required maxLength={80}/></label><label>Cost ($)<input type="number" min={0} max={10000} step="0.01" value={cost} onChange={e => setCost(Number(e.target.value))} required/></label></div>
    <label>Registration URL (optional)<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" maxLength={1000}/></label><label>Accessibility details<textarea value={accessibility} onChange={e => setAccessibility(e.target.value)} required minLength={5} maxLength={1000} rows={2} placeholder="Step-free access, quiet space, contact for accommodations…"/></label>
    <label className="checkbox-label"><input type="checkbox" checked={beginner} onChange={e => setBeginner(e.target.checked)}/>Welcoming to beginners</label>
    {event && <label>Event status<select value={status} onChange={e => setStatus(e.target.value as 'scheduled' | 'cancelled')}><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled — shown to students</option></select></label>}
    <ErrorMessage message={error}/><SubmitButton loading={loading}>{event ? 'Save event changes' : 'Publish demo event'}<Check size={16}/></SubmitButton>
  </form></Dialog>;
}

function ClubEditor({club, onClose, onSaved}: {club: Club; onClose: () => void; onSaved: () => void}) {
  const [fields, setFields] = useState({description: club.description, mission: club.mission, location: club.location, meeting_schedule: club.meeting_schedule, membership_fee: club.membership_fee, eligibility: club.eligibility, contact_email: club.contact_email, website: club.website, beginner_friendly: club.beginner_friendly});
  const [faqs, setFaqs] = useState(club.faqs.map(faq => ({...faq})));
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const field = (key: keyof typeof fields, value: string | boolean) => setFields({...fields, [key]: value});
  async function submit(e: FormEvent<HTMLFormElement>) {e.preventDefault(); setLoading(true); setError(''); try {await put(`/officer/clubs/${club.id}`, {...fields, faqs}); onSaved();} catch (e) {setError((e as Error).message);} finally {setLoading(false);}}
  return <Dialog title={`Edit ${cleanName(club.name)}`} wide onClose={onClose}><form className="form-stack" onSubmit={submit}>
    <label>Short description<textarea value={fields.description} onChange={e => field('description', e.target.value)} required minLength={10} maxLength={2000} rows={3}/></label><label>Mission<textarea value={fields.mission} onChange={e => field('mission', e.target.value)} required minLength={10} maxLength={2000} rows={3}/></label><label>Meeting schedule<input value={fields.meeting_schedule} onChange={e => field('meeting_schedule', e.target.value)} required maxLength={200}/></label><label>Meeting location<input value={fields.location} onChange={e => field('location', e.target.value)} required maxLength={200}/></label><div className="form-columns"><label>Membership fee<input value={fields.membership_fee} onChange={e => field('membership_fee', e.target.value)} required maxLength={150}/></label><label>Eligibility<input value={fields.eligibility} onChange={e => field('eligibility', e.target.value)} required maxLength={300}/></label></div><label>Contact email<input type="email" value={fields.contact_email} onChange={e => field('contact_email', e.target.value)} required/></label><label>Website (optional)<input type="url" value={fields.website} onChange={e => field('website', e.target.value)} placeholder="https://"/></label><label className="checkbox-label"><input type="checkbox" checked={fields.beginner_friendly} onChange={e => field('beginner_friendly', e.target.checked)}/>Welcoming to beginners</label>
    <fieldset className="faq-editor"><legend>Published questions & answers</legend><p className="fine-print">These answers are sources for the club assistant. Keep them factual and specific to your demo club.</p>{faqs.map((faq, index) => <div className="faq-editor-item" key={index}><label>Question {index + 1}<input value={faq.question} onChange={e => setFaqs(current => current.map((item, i) => i === index ? {...item, question: e.target.value} : item))} required minLength={3} maxLength={300}/></label><label>Answer<textarea value={faq.answer} onChange={e => setFaqs(current => current.map((item, i) => i === index ? {...item, answer: e.target.value} : item))} required minLength={3} maxLength={1500} rows={3}/></label><button type="button" className="text-button" onClick={() => setFaqs(current => current.filter((_, i) => i !== index))}>Remove question</button></div>)}<button type="button" className="button button-outline" onClick={() => setFaqs(current => [...current, {question: '', answer: ''}])} disabled={faqs.length >= 30}><Plus size={16}/>Add a question</button></fieldset><ErrorMessage message={error}/><SubmitButton loading={loading}>Save club profile<Check size={16}/></SubmitButton>
  </form></Dialog>;
}

export default function OfficerPanel({allEvents, onRefresh}: {allEvents: CampusEvent[]; onRefresh: () => void}) {
  const [clubs, setClubs] = useState<Club[]>([]); const [analytics, setAnalytics] = useState<Analytics | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [eventEdit, setEventEdit] = useState<CampusEvent | 'new' | null>(null); const [clubEdit, setClubEdit] = useState<Club | null>(null); const [success, setSuccess] = useState('');
  async function load() {setError(''); setLoading(true); try {const [c, a] = await Promise.all([api<Club[]>('/officer/clubs'), api<Analytics>('/officer/analytics')]); setClubs(c); setAnalytics(a);} catch (e) {setError((e as Error).message);} finally {setLoading(false);}}
  useEffect(() => {void load();}, []);
  const events = allEvents.filter(e => clubs.some(c => c.id === e.club_id));
  function saved() {setEventEdit(null); setClubEdit(null); setSuccess('Changes saved. Students can see the updated demo information.'); void load(); onRefresh();}
  if (loading && !clubs.length) return <div className="loading-state">Loading your club workspace…</div>;
  return <><div className="notice officer-notice"><ShieldBadge/>Officer workspace · You can manage only your assigned demo clubs. Officer access is checked on the server.</div><ErrorMessage message={error}/>{success && <p className="success-message" role="status">{success}</p>}
    {analytics && <><div className="analytics-grid">{[{label: 'Club follows', value: analytics.clubs.reduce((n, c) => n + c.follows, 0), icon: Users}, {label: 'Event saves', value: analytics.clubs.reduce((n, c) => n + c.saved_events, 0), icon: Heart}, {label: 'RSVPs', value: analytics.clubs.reduce((n, c) => n + c.rsvps, 0), icon: Check}, {label: 'Events published', value: analytics.clubs.reduce((n, c) => n + c.events, 0), icon: CalendarDays}].map(metric => <div className="surface analytics-card" key={metric.label}><metric.icon size={19}/><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div><p className="fine-print">{analytics.note} Totals represent actual actions in this demo, not campus attendance.</p></>}
    <div className="section-heading"><h2>Your club profiles</h2><button className="text-button" onClick={() => void load()}><RefreshCw size={14}/>Refresh metrics</button></div><div className="officer-clubs">{clubs.map(club => <div className="surface officer-club" key={club.id}><span className="club-initial" style={{background: `${club.color}18`, color: club.color}}>{club.short_name}</span><div><h3>{cleanName(club.name)}</h3><p>{club.campus} · Demo organization</p></div><button className="button button-outline" onClick={() => setClubEdit(club)}><Edit3 size={15}/>Edit profile</button></div>)}</div>
    <div className="section-heading"><h2>Your events<span className="count">{events.length}</span></h2><button className="button button-primary" onClick={() => setEventEdit('new')} disabled={!clubs.length}><Plus size={17}/>Create event</button></div><div className="surface officer-event-list">{events.map(event => <div className="officer-event" key={event.id}><CalendarDays size={20}/><div><h3>{event.title}</h3><p>{dateFormat(event.starts_at, {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})} ET · {event.status}</p></div><button className="icon-button" onClick={() => setEventEdit(event)} aria-label={`Edit ${event.title}`}><Edit3 size={18}/></button></div>)}{!events.length && <div className="empty-state"><CalendarDays size={28}/><h3>Your first event starts here.</h3><p>Create an event to help students get involved.</p></div>}</div>
    {eventEdit && <EventEditor clubs={clubs} event={eventEdit === 'new' ? null : eventEdit} onClose={() => setEventEdit(null)} onSaved={saved}/>}{clubEdit && <ClubEditor club={clubEdit} onClose={() => setClubEdit(null)} onSaved={saved}/>}</>;
}
function ShieldBadge() {return <Users size={17}/>;}
