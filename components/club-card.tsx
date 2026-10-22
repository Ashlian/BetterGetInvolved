import {ArrowUpRight, Bookmark, Check, MapPin, Sparkles} from 'lucide-react';
import {cleanName, type Club, type Recommendation} from '@/lib/api';
import {ClubArt} from './visuals';

export default function ClubCard({club, index = 0, following, onOpen, onFollow}: {club: Club | Recommendation; index?: number; following: boolean; onOpen: () => void; onFollow: () => void}) {
  return <article className="club-card">
    <button className="club-cover-button" onClick={onOpen} aria-label={`View ${cleanName(club.name)}`}><ClubArt category={club.category} color={club.color} variant={index}/></button>
    <button className={`card-save icon-button ${following ? 'is-saved' : ''}`} onClick={onFollow} aria-label={following ? `Unfollow ${cleanName(club.name)}` : `Follow ${cleanName(club.name)}`} aria-pressed={following}><Bookmark size={18} fill={following ? 'currentColor' : 'none'}/></button>
    <div className="club-card-content">
      <span className="eyebrow category-label">{club.category}</span>
      <button className="club-title-button" onClick={onOpen}><h3>{cleanName(club.name)}</h3><ArrowUpRight size={18}/></button>
      <p className="club-description">{club.description}</p>
      <div className="club-card-meta"><span><MapPin size={13}/>{club.campus}</span>{club.beginner_friendly && <span className="beginner-tag"><Check size={12}/>All experience levels</span>}</div>
      {'explanation' in club && <div className="recommendation-reason"><Sparkles size={13}/><span>{club.explanation}</span></div>}
    </div>
  </article>;
}
