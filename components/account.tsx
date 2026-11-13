'use client';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Check, LoaderCircle, LogOut, ShieldCheck, Trash2} from 'lucide-react';
import {api, post, put, CAMPUSES, INTERESTS, MAJORS, type AuthConfig, type User} from '@/lib/api';
import Dialog from './dialog';

export function ErrorMessage({message}: {message: string}) {return message ? <p className="form-error" role="alert">{message}</p> : null;}
export function SubmitButton({loading, children, className = 'button button-primary'}: {loading: boolean; children: React.ReactNode; className?: string}) {return <button className={className} type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17}/>Working…</> : children}</button>;}

type GoogleId = {
  initialize: (options: {client_id: string; callback: (response: {credential: string}) => void; hd?: string; ux_mode?: 'popup'; auto_select?: boolean; cancel_on_tap_outside?: boolean}) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
};
declare global {interface Window {google?: {accounts: {id: GoogleId}}}}

let googleScript: Promise<GoogleId> | null = null;
/** Google Identity Services, loaded once and only when someone opens sign-in. */
function loadGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  googleScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load.'));
    script.onerror = () => {googleScript = null; reject(new Error('Could not reach Google sign-in. Check your connection and try again.'));};
    document.head.appendChild(script);
  });
  return googleScript;
}

export function AuthDialog({onClose, onSuccess}: {onClose: () => void; onSuccess: (user: User, isNew: boolean) => void}) {
  const [config, setConfig] = useState<AuthConfig | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const buttonRef = useRef<HTMLDivElement>(null);
  const success = useRef(onSuccess); success.current = onSuccess;
  useEffect(() => {api<AuthConfig>('/auth/config').then(setConfig).catch(e => setError((e as Error).message));}, []);
  useEffect(() => {
    const clientId = config?.google_client_id; if (!clientId) return;
    let active = true;
    loadGoogle().then(google => {
      if (!active || !buttonRef.current) return;
      google.initialize({client_id: clientId, hd: config.allowed_domains[0], ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, callback: async ({credential}) => {
        setLoading(true); setError('');
        // A first sign-in (not yet onboarded) opens the interests and major step.
        try {const user = await post<User>('/auth/google', {credential}); success.current(user, !user.onboarded);}
        catch (e) {setError((e as Error).message);} finally {setLoading(false);}
      }});
      google.renderButton(buttonRef.current, {type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width: 300});
    }).catch(e => {if (active) setError((e as Error).message);});
    return () => {active = false;};
  }, [config]);
  async function demoLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    try {const user = await post<User>('/auth/login', {email, password}); onSuccess(user, !user.onboarded);}
    catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }
  const domain = config?.allowed_domains[0] || 'scarletmail.rutgers.edu';
  return <Dialog title="Sign in" onClose={onClose}>
    <p className="dialog-description">Use your Rutgers ScarletMail Google account (@{domain}). Signing in shows club contact details and lets you follow clubs and save events.</p>
    <div className="form-stack">
      {config?.google_client_id ? <div className="google-signin" ref={buttonRef} aria-busy={loading}/> : config && <p className="form-error" role="alert">Google sign-in isn’t set up on this server yet. Add GOOGLE_CLIENT_ID to .env and restart.</p>}
      {loading && <p className="fine-print" role="status"><LoaderCircle className="spin" size={15}/> Signing you in…</p>}
      <ErrorMessage message={error}/>
    </div>
    <div className="privacy-note"><ShieldCheck size={17}/><span>We only receive your name and ScarletMail address from Google. Your interests stay private. No student directory, public profile, or social tracking.</span></div>
    {config?.password_login && <details className="demo-credentials"><summary>Local demo accounts (demo mode only)</summary>
      <p>Student: <code>student@demo.local</code> / <code>StudentDemo2026!</code><br/>Officer: <code>officer@demo.local</code> / <code>OfficerDemo2026!</code></p>
      <form className="form-stack" onSubmit={demoLogin}>
        <label>Demo email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="student@demo.local"/></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128}/></label>
        <SubmitButton loading={loading} className="button button-outline">Sign in to demo account</SubmitButton>
      </form>
    </details>}
  </Dialog>;
}

function MajorField({value, onChange}: {value: string; onChange: (value: string) => void}) {
  return <label>Major<input list="rutgers-majors" value={value} onChange={e => onChange(e.target.value)} maxLength={100} placeholder="e.g. Computer Science, or Undecided"/><datalist id="rutgers-majors">{MAJORS.map(m => <option key={m} value={m}/>)}</datalist></label>;
}

export function OnboardingDialog({user, onClose, onSave}: {user: User; onClose: () => void; onSave: (user: User) => void}) {
  const [major, setMajor] = useState(user.major); const [interests, setInterests] = useState(user.interests); const [goals, setGoals] = useState(user.goals); const [campus, setCampus] = useState(user.campus || '');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true);
    try {onSave(await put<User>('/profile', {major: major.trim(), interests, goals, campus, onboarded: true}));} catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }
  return <Dialog title={user.onboarded ? 'Choose your interests' : `Welcome, ${user.display_name.split(' ')[0]}`} onClose={onClose}><p className="dialog-description">Tell us your major and what you’re into, and suggestions start from there. Everything is optional, and you can change it later in Profile.</p><form className="form-stack" onSubmit={submit}>
    <MajorField value={major} onChange={setMajor}/>
    <fieldset><legend>What are you curious about?</legend><div className="interest-picker">{INTERESTS.map(interest => <button key={interest} className={`interest-option ${interests.includes(interest) ? 'chosen' : ''}`} type="button" aria-pressed={interests.includes(interest)} onClick={() => setInterests(interests.includes(interest) ? interests.filter(i => i !== interest) : [...interests, interest])}>{interests.includes(interest) && <Check size={13}/>} {interest}</button>)}</div></fieldset>
    <label>Home campus<select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>What would you like to get out of campus life?<textarea value={goals} onChange={e => setGoals(e.target.value)} maxLength={1000} placeholder="Meet people, try something creative, build a robot…" rows={3}/></label><ErrorMessage message={error}/><SubmitButton loading={loading}>Save interests</SubmitButton><button className="text-button centered" type="button" onClick={onClose}>Skip for now</button>
  </form></Dialog>;
}

export function ProfilePanel({user, onSave, onLogout, onDelete}: {user: User; onSave: (user: User) => void; onLogout: () => void; onDelete: () => void}) {
  const [name, setName] = useState(user.display_name); const [major, setMajor] = useState(user.major); const [interests, setInterests] = useState(user.interests); const [goals, setGoals] = useState(user.goals); const [campus, setCampus] = useState(user.campus);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [deleting, setDeleting] = useState(false); const [confirm, setConfirm] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {e.preventDefault(); setError(''); setSaved(false); setLoading(true); try {onSave(await put<User>('/profile', {display_name: name, major: major.trim(), interests, goals, campus, onboarded: true})); setSaved(true);} catch (e) {setError((e as Error).message);} finally {setLoading(false);}}
  async function deleteAccount() {setLoading(true); setError(''); try {await api('/auth/me', {method: 'DELETE'}); onDelete();} catch (e) {setError((e as Error).message); setLoading(false);}}
  return <div className="profile-layout"><section className="surface profile-form"><div className="profile-intro"><span className="profile-avatar">{user.display_name.slice(0, 1).toUpperCase()}</span><div><h2>{user.display_name}</h2><p>Your major and interests shape suggestions. Change them anytime.</p></div></div><form className="form-stack" onSubmit={submit}>
    <div className="form-columns"><label>Preferred name<input value={name} onChange={e => {setName(e.target.value); setSaved(false);}} required minLength={2} maxLength={80}/></label><label>Email<input value={user.email} disabled readOnly/></label></div>
    <div className="form-columns"><MajorField value={major} onChange={value => {setMajor(value); setSaved(false);}}/><label>Home campus<select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select></label></div>
    <fieldset><legend>Your interests</legend><div className="interest-picker">{INTERESTS.map(interest => <button key={interest} type="button" className={`interest-option ${interests.includes(interest) ? 'chosen' : ''}`} aria-pressed={interests.includes(interest)} onClick={() => setInterests(interests.includes(interest) ? interests.filter(i => i !== interest) : [...interests, interest])}>{interest}{interests.includes(interest) && <Check size={13}/>}</button>)}</div></fieldset>
    <label>Your campus goals<textarea value={goals} onChange={e => setGoals(e.target.value)} rows={4} maxLength={1000} placeholder="What are you hoping to find?"/></label><ErrorMessage message={error}/><div className="form-actions"><SubmitButton loading={loading}>Save preferences<Check size={17}/></SubmitButton>{saved && <span className="success-message" role="status">Preferences saved</span>}</div>
  </form></section><aside className="profile-aside"><div className="surface privacy-card"><ShieldCheck size={25}/><h3>Privacy</h3><p>Your profile is private. We use your major, interests, and goals to suggest clubs. Suggestions can miss the mark; you can always explore the full directory.</p><p>We do not use sensitive traits, sell profile data, or track you across websites.</p><div className="mini-divider"/><p className="fine-print">Account type: {user.role}. Signed in as {user.email}. BetterGetInvolved is a student project, not an official Rutgers service.</p><button className="button button-outline full-width" onClick={onLogout}><LogOut size={16}/>Sign out</button></div><button className="delete-button" onClick={() => setDeleting(true)}><Trash2 size={15}/>Delete my account and data</button></aside>
    {deleting && <Dialog title="Delete your account?" onClose={() => setDeleting(false)}><p className="dialog-description">This permanently removes your profile, preferences, follows, saved events, session, and forum posts and comments. Removing your posts also deletes other people's replies to those posts. Type DELETE to confirm.</p><label className="form-stack">Confirmation<input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="DELETE"/></label><ErrorMessage message={error}/><button className="button button-danger full-width" disabled={confirm !== 'DELETE' || loading} onClick={deleteAccount}>Permanently delete account</button></Dialog>}
  </div>;
}
