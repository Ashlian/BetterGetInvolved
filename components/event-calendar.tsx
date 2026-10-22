import {useState} from 'react';
import {ArrowLeft, ArrowRight, Bookmark, CalendarDays, ChevronRight, Clock3, List, MapPin} from 'lucide-react';
import {type CampusEvent, cleanName, dateFormat, eventTime} from '@/lib/api';

export function EventRow({event, saved, onOpen, onSave}: {event: CampusEvent; saved: boolean; onOpen: () => void; onSave: () => void}) {
  return <article className={`event-row ${event.status === 'cancelled' ? 'cancelled' : ''}`}>
    <button className="event-date" onClick={onOpen} aria-label={`View ${event.title}`}><span>{dateFormat(event.starts_at, {month: 'short'})}</span><strong>{dateFormat(event.starts_at, {day: '2-digit'})}</strong></button>
    <button className="event-info plain-button" onClick={onOpen}><span className="event-club">{cleanName(event.club_name)}</span><h3>{event.title}{event.status === 'cancelled' && <span className="cancelled-tag">Cancelled</span>}</h3><p><span><Clock3 size={13}/>{eventTime(event.starts_at)}</span><span><MapPin size={13}/>{event.campus}</span>{event.cost === 0 && <span className="free-tag">Free</span>}</p></button>
    <button className={`icon-button ${saved ? 'is-saved' : ''}`} aria-label={`${saved ? 'Unsave' : 'Save'} ${event.title}`} aria-pressed={saved} onClick={onSave}><Bookmark size={19} fill={saved ? 'currentColor' : 'none'}/></button>
    <button className="icon-button event-chevron" onClick={onOpen} aria-label={`Event details for ${event.title}`}><ChevronRight size={19}/></button>
  </article>;
}

export default function EventCalendar({events, savedIds, onOpen, onSave}: {events: CampusEvent[]; savedIds: string[]; onOpen: (event: CampusEvent) => void; onSave: (event: CampusEvent) => void}) {
  const [month, setMonth] = useState(new Date(2026, 9, 1, 12));
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
    <div className="calendar-toolbar"><div className="calendar-month"><button className="icon-button" onClick={() => shift(-1)} aria-label="Previous month"><ArrowLeft size={17}/></button><h2>{month.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</h2><button className="icon-button" onClick={() => shift(1)} aria-label="Next month"><ArrowRight size={17}/></button></div><div className="segmented"><button className={display === 'month' ? 'selected' : ''} onClick={() => setDisplay('month')}><CalendarDays size={16}/>Month</button><button className={display === 'list' ? 'selected' : ''} onClick={() => setDisplay('list')}><List size={16}/>List</button></div></div>
    {display === 'month' && <div className="calendar" aria-label="Campus events calendar"><div className="calendar-days">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">
      {Array.from({length: offset}, (_, i) => <div className="calendar-cell outside" key={`empty-${i}`}/>)}
      {Array.from({length: days}, (_, i) => {
        const day = i + 1; const daily = inMonth.filter(e => Number(dateFormat(e.starts_at, {day: 'numeric'})) === day);
        const reference = month.getFullYear() === 2026 && month.getMonth() === 9 && day === 22;
        return <button key={day} className={`calendar-cell ${selected === day ? 'day-selected' : ''} ${reference ? 'reference-day' : ''}`} onClick={() => setSelected(selected === day ? null : day)} aria-label={`${month.toLocaleDateString('en-US', {month: 'long'})} ${day}, ${daily.length} events`}><span className="day-number">{day}</span><div className="calendar-event-labels">{daily.slice(0, 2).map(e => <span className={e.status === 'cancelled' ? 'cancelled' : ''} key={e.id}>{e.title}</span>)}{daily.length > 2 && <small>+{daily.length - 2} more</small>}</div>{daily.length > 0 && <span className="mobile-event-dot"/>}</button>;
      })}
    </div></div>}
    <div className="section-heading calendar-list-heading"><h2>{selected ? `Events on ${month.toLocaleDateString('en-US', {month: 'short'})} ${selected}` : 'On the calendar'}<span className="count">{visible.length}</span></h2>{selected && <button className="text-button" onClick={() => setSelected(null)}>Show all dates</button>}</div>
    <div className="event-list">{visible.length ? visible.map(event => <EventRow key={event.id} event={event} saved={savedIds.includes(event.id)} onOpen={() => onOpen(event)} onSave={() => onSave(event)}/>) : <div className="empty-state"><CalendarDays size={30}/><h3>No events on these dates</h3><p>Try another day or month. New experiences are worth the wait.</p></div>}</div>
    <p className="fine-print">All times are Eastern Time (America/New_York). Calendar reference date: October 22, 2026.</p>
  </>;
}
