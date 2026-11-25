'use client';

import {useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {motion,useMotionValue,useReducedMotion,useScroll,useSpring,useTransform} from 'motion/react';
import {ArrowRight,Compass,Heart,Search,Shuffle} from 'lucide-react';
import {cleanName,relativeTime,type CampusEvent,type Club,type ForumPost,type Recommendation,type Saved,type User} from '@/lib/api';
import RecommendationCard from './recommendation-card';
import {CampusMap} from './campus-map';
import {EventRow} from './event-calendar';
import './home-experience.css';

type Props={firstName?:string;user:User|null;clubs:(Club|Recommendation)[];events:CampusEvent[];announcements:ForumPost[]|null;saved:Saved;busy:boolean;swipeRemaining:number;onOpenClub:(club:Club)=>void;onSave:(club:Club)=>void;onDismiss:(club:Club)=>void;onOpenEvent:(event:CampusEvent)=>void;onSaveEvent:(event:CampusEvent)=>void;onSearch:(query:string)=>void;onDiscover:()=>void;onDaily:()=>void;onOrbit:()=>void;onEvents:()=>void;onCommunity:()=>void;};
const examples=['Beginner-friendly AI clubs','Something fun on Busch tonight','Clubs where I can meet new people','Research and engineering opportunities'];

export default function HomeExperience({firstName,user,clubs,events,announcements,saved,busy,swipeRemaining,onOpenClub,onSave,onDismiss,onOpenEvent,onSaveEvent,onSearch,onDiscover,onDaily,onOrbit,onEvents,onCommunity}:Props){
  const [query,setQuery]=useState('');const hero=useRef<HTMLElement>(null);const reduced=useReducedMotion();
  const pointerX=useMotionValue(0);const pointerY=useMotionValue(0);const springX=useSpring(pointerX,{stiffness:80,damping:24});const springY=useSpring(pointerY,{stiffness:80,damping:24});
  const {scrollYProgress}=useScroll({target:hero,offset:['start start','end start']});const photoY=useTransform(scrollYProgress,[0,1],[0,22]);const photoScale=useTransform(scrollYProgress,[0,1],[1.025,1.08]);
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(query.trim())onSearch(query.trim());}
  function searchExample(term:string){setQuery(term);onSearch(term);}
  const picks=clubs.slice(0,3);const campusEvents=events.filter(event=>event.status==='scheduled').slice(0,2);
  return <div className="home-experience">
    <section className="home-hero" ref={hero} aria-labelledby="home-title">
      <div className="home-hero-copy"><p className="home-kicker">RUTGERS–NEW BRUNSWICK{firstName?` · WELCOME, ${firstName.toUpperCase()}`:''}</p><motion.h1 id="home-title" initial={reduced?false:{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:.55,ease:[.22,.8,.25,1]}}>Find your<br/><em>community.</em></motion.h1><p className="home-lede">Discover the people, clubs, and experiences that make Rutgers yours.</p>
        <form className="home-search" role="search" onSubmit={submit}><Search size={19} aria-hidden="true"/><input aria-label="Search Rutgers clubs and interests" placeholder="Search clubs and interests" value={query} onChange={event=>setQuery(event.target.value)}/><button type="submit" aria-label="Search"><ArrowRight size={19}/></button></form>
        <div className="home-suggestions" aria-label="Suggested searches">{examples.map(term=><button key={term} type="button" onClick={()=>searchExample(term)}>{term}</button>)}</div>
      </div>
      <motion.figure className="home-hero-photo" style={reduced?undefined:{y:photoY,scale:photoScale,x:springX}} onPointerMove={event=>{if(reduced||event.pointerType!=='mouse')return;const box=event.currentTarget.getBoundingClientRect();pointerX.set(Math.max(-7,Math.min(7,((event.clientX-box.left)/box.width-.5)*14)));pointerY.set(Math.max(-5,Math.min(5,((event.clientY-box.top)/box.height-.5)*10)));}} onPointerLeave={()=>{pointerX.set(0);pointerY.set(0);}}>
        <motion.img style={reduced?undefined:{y:springY}} src="/rutgers-college-avenue.jpg" alt="The College Avenue campus at Rutgers–New Brunswick"/><figcaption>COLLEGE AVENUE CAMPUS <a href="https://commons.wikimedia.org/wiki/File:Rutgers_University_scene_at_College_Campus.JPG" target="_blank" rel="noreferrer">Photo: Tomwsulcer / Wikimedia Commons · CC0</a></figcaption>
      </motion.figure>
    </section>

    <motion.section className="home-picks" aria-labelledby="home-picks-title" initial={reduced?false:{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.12}} transition={{duration:.45}}>
      <header className="home-section-heading"><div><p className="home-kicker">BASED ON WHAT YOU LIKE</p><h2 id="home-picks-title">Made for you</h2></div><button type="button" className="home-text-link" onClick={onDiscover}>See all in Discover <ArrowRight size={16}/></button></header>
      {picks.length?<div className="home-pick-grid">{picks.map((club,index)=><motion.div key={club.id} initial={reduced?false:{opacity:0,y:13}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.12}} transition={{duration:.35,delay:index*.07}}><RecommendationCard club={club} busy={busy} saved={(saved.maybe_later_ids||[]).includes(club.id)} onOpen={()=>onOpenClub(club)} onSave={()=>onSave(club)} onDismiss={()=>onDismiss(club)}/></motion.div>)}</div>:<div className="home-empty-picks"><p>{user?'No new recommendations right now. Try changing interests in Profile.':'Browse clubs, or sign in to get recommendations shaped by your interests.'}</p><button type="button" className="home-text-link" onClick={onDiscover}>{user?'Explore clubs':'Explore Discover'} <ArrowRight size={16}/></button></div>}
    </motion.section>

    <div className="home-feature-row">
      <section className="daily-feature" aria-labelledby="daily-feature-title"><div className="daily-art-stack" aria-hidden="true"><div className="daily-card-back"/><div className="daily-card-mid"/><div className="daily-card-front"><span>DAILY DISCOVERY</span><strong>{picks[0]?cleanName(picks[0].name):'A new club, one at a time.'}</strong><small>{Math.max(0,swipeRemaining)} clubs to explore</small></div><span className="daily-spark"><Shuffle size={19}/></span></div><div className="daily-feature-copy"><p className="home-kicker">A LITTLE EVERY DAY</p><h2 id="daily-feature-title">Find your kind<br/>of people.</h2><p>Meet clubs one at a time. Follow the ones that feel right.</p><button type="button" className="home-primary-link" onClick={onDaily}>Start today’s discovery <ArrowRight size={17}/></button></div></section>
      <section className="orbit-feature" aria-labelledby="orbit-feature-title"><header className="home-section-heading"><div><p className="home-kicker">AROUND RUTGERS</p><h2 id="orbit-feature-title">In your orbit.</h2><p>See what’s happening around campus.</p></div><button type="button" className="home-icon-link" onClick={onOrbit} aria-label="Open Orbit"><ArrowRight size={19}/></button></header><div className="home-map-frame"><CampusMap events={events} user={user} onOpenEvent={onOpenEvent} preview/></div></section>
    </div>

    <section className="campus-activity" aria-labelledby="campus-activity-title"><header className="home-section-heading"><div><p className="home-kicker">CAMPUS LIFE</p><h2 id="campus-activity-title">Coming up at Rutgers</h2></div><button type="button" className="home-text-link" onClick={onEvents}>All events <ArrowRight size={16}/></button></header><div className="activity-columns"><div className="home-event-list">{campusEvents.length?campusEvents.map(event=><EventRow key={event.id} event={event} saved={saved.event_ids.includes(event.id)} onOpen={()=>onOpenEvent(event)} onSave={()=>onSaveEvent(event)}/>):<p className="home-activity-empty">No upcoming events are listed right now.</p>}</div><div className="home-community-note"><div className="home-community-title"><Heart size={17}/><span>From the community</span><button type="button" onClick={onCommunity} aria-label="Open community"><ArrowRight size={16}/></button></div>{announcements?.length?announcements.slice(0,2).map(item=><Link key={item.id} href={`/forums/${encodeURIComponent(item.id)}`} className="home-announcement"><small>{cleanName(item.club_name)} · {relativeTime(item.created_at)}</small><strong>{item.title}</strong><span>{item.body}</span></Link>):<div className="home-activity-empty">{announcements===null?'Checking followed-club updates…':'Follow clubs to see their announcements here.'}</div>}</div></div></section>
  </div>;
}
