import {Bookmark, Check, Sparkles} from 'lucide-react';
import {cleanName, type Club, type Recommendation} from '@/lib/api';
import {CampusMark, ClubArt} from './visuals';

export default function ClubCard({club, following, showReason = true, onOpen, onFollow}: {club: Club | Recommendation; index?: number; following: boolean; showReason?: boolean; onOpen: () => void; onFollow: () => void}) {
  return <article className="club-card" style={{'--club': club.color} as React.CSSProperties}>
    <div className="club-card-head"><ClubArt category={club.category} color={club.color}/>
      <button className={`card-save icon-button ${following ? 'is-saved' : ''}`} onClick={onFollow} aria-label={following ? `Unfollow ${cleanName(club.name)}` : `Follow ${cleanName(club.name)}`} aria-pressed={following}><Bookmark size={19} fill={following ? 'currentColor' : 'none'}/></button></div>
    <button className="club-card-body plain-button" onClick={onOpen}>
      <span className="category-label">{club.category}</span>
      <h3>{cleanName(club.name)}</h3>
      <p className="club-description">{club.description}</p>
    </button>
    <div className="club-card-meta"><CampusMark campus={club.campus}/>{club.beginner_friendly && <span className="meta-note"><Check size={14}/>Beginners welcome</span>}</div>
    {showReason && 'explanation' in club && <p className="recommendation-reason"><Sparkles size={14}/><span>{club.explanation}</span></p>}
  </article>;
}
