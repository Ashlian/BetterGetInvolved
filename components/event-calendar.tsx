import {useState} from 'react';
import {Bookmark, CalendarDays, ChevronLeft, ChevronRight, List} from 'lucide-react';
import {type CampusEvent, cleanName, dateFormat, eventTime} from '@/lib/api';
import {CampusMark, campusSlug} from './visuals';

export function EventRow({event, saved, onOpen, onSave}: {event: CampusEvent; saved: boolean; onOpen: () => void; onSave: () => void}) {
  return <article className={`event-row ${event.status === 'cancelled' ? 'cancelled' : ''}`}>
    <button className="event-main plain-button" onClick={onOpen}>
      <span className="event-date"><small>{dateFormat(event.starts_at, {month: 'short'})}</small><strong>{dateFormat(event.starts_at, {day: 'numeric'})}</strong></span>
      <span className="event-info"><span className="event-club">{cleanName(event.club_name)}</span><strong className="event-title">{event.title}</strong>
        <span className="event-meta"><span className="tabular">{eventTime(event.starts_at)}</span>{event.campus ? <CampusMark campus={event.campus}/> : <span className="event-place">{event.location}</span>}{event.cost === 0 && <span>Free</span>}{event.is_demo && <span className="demo-tag">Demo</span>}{event.status === 'cancelled' && <span className="cancelled-tag">Cancelled</span>}</span></span>
      <ChevronRight className="event-chevron" size={18} aria-hidden="true"/>
    </button>
    <button className={`icon-button ${saved ? 'is-saved' : ''}`} aria-label={`${saved ? 'Unsave' : 'Save'} ${event.title}`} aria-pressed={saved} onClick={onSave}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'}/></button>
  </article>;
}

type Day = {year: number; month: number; day: number};
export const easternDay = (iso: string | Date): Day => {const [month, day, year] = dateFormat(iso, {year: 'numeric', month: '2-digit', day: '2-digit'}).split('/').map(Number); return {year, month, day};};

export default function EventCalendar({events, savedIds, onOpen, onSave, today, footnote}: {events: CampusEvent[]; savedIds: string[]; onOpen: (event: CampusEvent) => void; onSave: (event: CampusEvent) => void; today: Day; footnote: string}) {
  const [month, setMonth] = useState(new Date(today.year, today.month - 1, 1, 12));
  const [display, setDisplay] = useState<'month' | 'list'>('month');
  const [selected, setSelected] = useState<number | null>(null);
  const inMonth = events.filter(e => {
    const parts = dateFormat(e.starts_at, {year: 'numeric', month: '2-digit'}).split('/');
    return Number(parts[0]) === month.getMonth() + 1 && Number(parts[1]) === month.getFullYear();
  });
  const visible = selected ? inMonth.filter(e => Number(dateFormat(e.starts_at, {day: 'numeric'})) === selected) : inMonth;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  function shift(amount: number) {setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1, 12)); setSelected(null);}
  return <>
    <div className="calendar-toolbar"><div className="calendar-month"><button className="icon-button" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={20}/></button><h2>{month.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</h2><button className="icon-button" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={20}/></button></div><div className="segmented" role="group" aria-label="Calendar display"><button className={display === 'month' ? 'selected' : ''} aria-pressed={display === 'month'} onClick={() => setDisplay('month')}><CalendarDays size={16}/>Month</button><button className={display === 'list' ? 'selected' : ''} aria-pressed={display === 'list'} onClick={() => setDisplay('list')}><List size={16}/>List</button></div></div>
    {display === 'month' && <div className="calendar surface" aria-label="Campus events calendar"><div className="calendar-days" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">
      {Array.from({length: offset}, (_, i) => <div className="calendar-cell outside" key={`empty-${i}`}/>)}
      {Array.from({length: days}, (_, i) => {
        const day = i + 1; const daily = inMonth.filter(e => Number(dateFormat(e.starts_at, {day: 'numeric'})) === day);
        const reference = month.getFullYear() === today.year && month.getMonth() + 1 === today.month && day === today.day;
        return <button key={day} className={`calendar-cell ${selected === day ? 'day-selected' : ''} ${reference ? 'reference-day' : ''}`} onClick={() => setSelected(selected === day ? null : day)} aria-pressed={selected === day} aria-label={`${month.toLocaleDateString('en-US', {month: 'long'})} ${day}${reference ? ', today' : ''}, ${daily.length} ${daily.length === 1 ? 'event' : 'events'}`}><span className="day-number">{day}</span><span className="calendar-event-labels">{daily.slice(0, 2).map(e => <span className={`${e.campus ? `campus-${campusSlug(e.campus)}` : ''} ${e.status === 'cancelled' ? 'cancelled' : ''}`} key={e.id}>{e.title}</span>)}{daily.length > 2 && <small>+{daily.length - 2} more</small>}</span>{daily.length > 0 && <span className="calendar-dots" aria-hidden="true">{daily.slice(0, 3).map(e => <i className={`${e.campus ? `campus-${campusSlug(e.campus)}` : ''}`} key={e.id}/>)}</span>}</button>;
      })}
    </div></div>}
    <div className="section-heading"><h2>{selected ? `${month.toLocaleDateString('en-US', {month: 'long'})} ${selected}` : 'All events this month'}<span className="count">{visible.length}</span></h2>{selected && <button className="text-button" onClick={() => setSelected(null)}>Show all dates</button>}</div>
    <div className="event-list surface">{visible.length ? visible.map(event => <EventRow key={event.id} event={event} saved={savedIds.includes(event.id)} onOpen={() => onOpen(event)} onSave={() => onSave(event)}/>) : <div className="empty-state"><CalendarDays size={30}/><h3>No events on this date</h3><p>Pick another day, or switch months.</p></div>}</div>
    <p className="fine-print">{footnote}</p>
  </>;
}
