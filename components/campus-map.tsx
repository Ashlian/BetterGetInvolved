'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {CalendarDays, Compass, LocateFixed, MapPin, Radio, SlidersHorizontal, X} from 'lucide-react';
import type * as maplibregl from 'maplibre-gl';
import {dateFormat, dateKey, type CampusEvent} from '@/lib/api';
import {CAMPUSES, type User} from '@/lib/api';
import './campus-map.css';

type WindowFilter='all'|'today'|'tomorrow'|'week'|'for-you';
type CampusPoint={center:[number,number];zoom:number;note:string};
// Campus centers follow OpenStreetMap campus areas. Event records contain campus names but
// no coordinates, so event pins intentionally mark the campus area rather than a building.
const CAMPUS_POINTS:Record<string,CampusPoint>={
  'All campuses':{center:[-74.452,40.505],zoom:12.5,note:'Five-campus overview'},
  'Busch':{center:[-74.46917,40.52068],zoom:14,note:'Campus area · approximate'},
  'Livingston':{center:[-74.44342,40.51874],zoom:14,note:'Campus area · approximate'},
  'College Avenue':{center:[-74.45049,40.50189],zoom:15,note:'Campus area · approximate'},
  'Cook':{center:[-74.43679,40.47895],zoom:14,note:'Campus area · approximate'},
  'Douglass':{center:[-74.43712,40.48496],zoom:14,note:'Campus area · approximate'},
};
const TILE_STYLE={version:8 as const,sources:{openstreetmap:{type:'raster' as const,tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}},layers:[{id:'openstreetmap',type:'raster' as const,source:'openstreetmap'}]};

function dayWindow(date:string,from:Date,to:Date){const time=Date.parse(date);return time>=from.getTime()&&time<to.getTime();}
function eventIcon(category:string){const value=category.toLowerCase();const paths=/music|perform|dance/.test(value)?'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>':/sport|fitness|game/.test(value)?'<circle cx="12" cy="12" r="9"/><path d="m8 3 8 18M3 8l18 8M3 16l18-8M16 3 8 21"/>':/career|professional|network/.test(value)?'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/>':/art|design|creative/.test(value)?'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.6-3.2 1.7 1.7 0 0 1 1.4-2.8H18a3 3 0 0 0 3-3c0-5-4-9-9-9Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="10" r="1"/>':/volunteer|service|community/.test(value)?'<path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6a4.6 4.6 0 0 1 8.8-1.8 4.6 4.6 0 0 1 8.8 1.8Z"/>':/academic|science|research|technology/.test(value)?'<path d="M12 3 2 8l10 5 10-5-10-5ZM4 10v6l8 5 8-5v-6M22 8v6"/>':'<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>';return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;}

export function CampusMap({events,user,onOpenEvent,preview=false}:{events:CampusEvent[];user:User|null;onOpenEvent:(event:CampusEvent)=>void;preview?:boolean}){
  const container=useRef<HTMLDivElement>(null);const map=useRef<maplibregl.Map|null>(null);const library=useRef<typeof import('maplibre-gl')|null>(null);const markers=useRef<maplibregl.Marker[]>([]);
  const [campus,setCampus]=useState(user?.campus&&CAMPUSES.includes(user.campus)?user.campus:'All campuses');
  const [windowFilter,setWindowFilter]=useState<WindowFilter>('all');const [categoryFilter,setCategoryFilter]=useState('');const [selected,setSelected]=useState<CampusEvent|null>(null);const [mapError,setMapError]=useState('');const [styleReady,setStyleReady]=useState(false);const [radarPaused,setRadarPaused]=useState(false);
  const now=new Date();const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());const dateToken=todayStart.toDateString();const tomorrow=new Date(todayStart);tomorrow.setDate(tomorrow.getDate()+1);const afterTomorrow=new Date(tomorrow);afterTomorrow.setDate(afterTomorrow.getDate()+1);const weekEnd=new Date(todayStart);weekEnd.setDate(weekEnd.getDate()+7);
  const filtered=useMemo(()=>events.filter(event=>{
    if(event.status!=='scheduled')return false;
    if(campus!=='All campuses'&&event.campus!==campus)return false;
    if(categoryFilter&&event.category!==categoryFilter)return false;
    if(windowFilter==='for-you'&&user?.interests.length&&!user.interests.some(interest=>`${event.category} ${event.title} ${event.description}`.toLowerCase().includes(interest.toLowerCase())))return false;
    if(windowFilter==='today'&&!dayWindow(event.starts_at,todayStart,tomorrow))return false;
    if(windowFilter==='tomorrow'&&!dayWindow(event.starts_at,tomorrow,afterTomorrow))return false;
    if(windowFilter==='week'&&!dayWindow(event.starts_at,todayStart,weekEnd))return false;
    return true;
  }).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)),[events,campus,windowFilter,categoryFilter,user?.interests,dateToken]);

  useEffect(()=>{
    if(!container.current||map.current)return;
    let cancelled=false;
    void import('maplibre-gl').then(loaded=>{
      const ml=loaded;library.current=loaded;
      if(cancelled||!container.current)return;
      try{
        // Webpack's import.meta.url is not an HTTP URL, so MapLibre's default worker
        // URL resolves to the current route. Serve the installed worker as a static asset.
        ml.setWorkerUrl(new URL('/maplibre-gl-worker.mjs',window.location.origin).href);
        const instance=new ml.Map({container:container.current,style:TILE_STYLE,center:CAMPUS_POINTS[campus].center,zoom:CAMPUS_POINTS[campus].zoom,minZoom:10,maxZoom:18,attributionControl:{compact:true},cooperativeGestures:true});
        instance.addControl(new ml.NavigationControl({showCompass:false}),preview?'top-right':'top-right');
        instance.on('load',()=>setStyleReady(true));
        map.current=instance;
      }catch{setMapError('The map could not start in this browser. The accessible campus event list is still available.');}
    }).catch(()=>{if(!cancelled)setMapError('MapLibre could not load. The accessible campus event list is still available.');});
    return()=>{cancelled=true;markers.current.forEach(marker=>marker.remove());markers.current=[];map.current?.remove();map.current=null;};
  },[]);
  useEffect(()=>{if(!map.current)return;const target=CAMPUS_POINTS[campus];map.current.flyTo({center:target.center,zoom:target.zoom,duration:700,essential:false});},[campus]);
  useEffect(()=>{
    if(!map.current||!styleReady)return;
    markers.current.forEach(marker=>marker.remove());markers.current=[];
    for(const event of filtered){
      const point=CAMPUS_POINTS[event.campus];if(!point)continue;
      const element=document.createElement('button');element.type='button';element.className='event-map-marker';element.setAttribute('aria-label',`${event.title}, ${event.campus} campus area`);element.title=`${event.title} · ${event.campus} campus area`;
      const icon=document.createElement('span');icon.className='event-marker-icon';icon.innerHTML=eventIcon(event.category);element.append(icon);
      element.addEventListener('click',()=>setSelected(event));
      const Marker=library.current?.Marker;if(!Marker)continue;
      const sameCampusBefore=filtered.slice(0,filtered.indexOf(event)).filter(item=>item.campus===event.campus).length;
      const offsets:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[19,-13],[-19,-13],[0,-28]];
      const offset=offsets[sameCampusBefore%offsets.length];
      markers.current.push(new Marker({element,anchor:'bottom',offset}).setLngLat(point.center).addTo(map.current));
    }
  },[filtered,styleReady,campus]);
  useEffect(()=>{if(preview&&map.current){map.current.dragPan.disable();map.current.scrollZoom.disable();map.current.doubleClickZoom.disable();}},[preview,styleReady]);
  const filterOptions:WindowFilter[]=['all','today','tomorrow','week',...(user?.interests.length?['for-you' as const]:[])];
  const mapSurface=<div className={`campus-map${preview?' map-preview':''}`}>
    <div className="campus-map-canvas" ref={container} aria-label="Interactive OpenStreetMap of Rutgers–New Brunswick campuses" role="application" />
    {preview&&<div className="map-preview-scrim" aria-hidden="true"/>}
    {mapError&&<p className="map-error" role="status">{mapError}</p>}
    {!preview&&<><div className="map-top-label"><Compass size={15}/>{CAMPUS_POINTS[campus].note}</div><div className={`radar-pulse ${radarPaused?'paused':''}`} aria-hidden="true"/><button className="radar-toggle" type="button" aria-pressed={!radarPaused} onClick={()=>setRadarPaused(value=>!value)}>{radarPaused?'Radar off':'Radar on'}</button><button className="map-reset" type="button" aria-label="Reset map view" onClick={()=>map.current?.flyTo({center:CAMPUS_POINTS[campus].center,zoom:CAMPUS_POINTS[campus].zoom,duration:600})}><LocateFixed size={17}/></button><a className="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></>}
    {preview&&<a className="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
    {selected&&!preview&&<div className="map-event-popover"><button type="button" className="map-popover-close" aria-label="Close event preview" onClick={()=>setSelected(null)}><X size={16}/></button><small>{dateFormat(selected.starts_at,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · {selected.campus} (approx.)</small><strong>{selected.title}</strong><span>{selected.club_name}</span><button type="button" className="map-open-event" onClick={()=>onOpenEvent(selected)}>Event details <CalendarDays size={14}/></button></div>}
  </div>;
  if(preview)return <div className="map-preview-shell">{mapSurface}<button type="button" className="map-preview-link" onClick={()=>{window.history.pushState({view:'orbit'},'','/orbit');window.dispatchEvent(new PopStateEvent('popstate'));}}>Explore Orbit <MapPin size={15}/></button></div>;
  return <section className="orbit-workspace" aria-label="Orbit campus events">
    <div className="orbit-toolbar"><div className="orbit-campus-filter" role="group" aria-label="Choose campus">{['All campuses',...CAMPUSES].map(item=><button key={item} type="button" className={campus===item?'selected':''} aria-pressed={campus===item} onClick={()=>setCampus(item)}>{item==='All campuses'?'All':item}</button>)}</div><div className="orbit-filter-group"><div className="orbit-time-filter"><SlidersHorizontal size={16}/><select aria-label="Filter events by date" value={windowFilter} onChange={e=>setWindowFilter(e.target.value as WindowFilter)}>{filterOptions.map(item=><option key={item} value={item}>{item==='all'?'All events':item==='for-you'?'For you':item==='week'?'This week':item[0].toUpperCase()+item.slice(1)}</option>)}</select></div><div className="orbit-time-filter"><select aria-label="Filter events by category" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{[...new Set(events.map(event=>event.category).filter(Boolean))].sort().map(category=><option key={category}>{category}</option>)}</select></div></div></div>
    <div className="orbit-layout"><div>{mapSurface}<p className="map-location-note"><MapPin size={14}/>Pins mark campus areas when an event record has no building coordinates.</p></div><aside className="orbit-event-list"><header><div><h2>On campus</h2><p>{filtered.length} {filtered.length===1?'event':'events'} in this view</p></div><Radio size={17}/></header>{filtered.length?filtered.map(event=><button key={event.id} className={`orbit-event-row ${selected?.id===event.id?'chosen':''}`} type="button" onClick={()=>{setSelected(event);onOpenEvent(event);}}><span className="orbit-event-time">{dateFormat(event.starts_at,{weekday:'short',month:'short',day:'numeric'})}<b>{dateFormat(event.starts_at,{hour:'numeric',minute:'2-digit'})}</b></span><span className="orbit-event-copy"><strong>{event.title}</strong><small>{event.club_name}</small><small>{event.location||`${event.campus} campus area (approx.)`}</small></span><MapPin size={16}/></button>):<p className="orbit-empty">No events match these filters.</p>}</aside></div>
  </section>;
}
