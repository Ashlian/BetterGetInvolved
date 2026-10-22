'use client';
import {useState, type FormEvent} from 'react';
import {ArrowRight, Check, GraduationCap, LoaderCircle, LogOut, ShieldCheck, Sparkles, Trash2} from 'lucide-react';
import {api, post, put, CAMPUSES, INTERESTS, type User} from '@/lib/api';
import Dialog from './dialog';

export function ErrorMessage({message}: {message: string}) {return message ? <p className="form-error" role="alert">{message}</p> : null;}
export function SubmitButton({loading, children, className = 'button button-primary'}: {loading: boolean; children: React.ReactNode; className?: string}) {return <button className={className} type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17}/>Working…</> : children}</button>;}

export function AuthDialog({onClose, onSuccess}: {onClose: () => void; onSuccess: (user: User, isNew: boolean) => void}) {
  const [register, setRegister] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    try {const user = await post<User>(register ? '/auth/register' : '/auth/login', {email, password, ...(register ? {display_name: name} : {})}); onSuccess(user, register);}
    catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }
  return <Dialog title={register ? 'Your people are out there.' : 'Welcome back.'} onClose={onClose}>
    <p className="dialog-description">{register ? 'Create your private student profile to save clubs and make campus feel a little smaller.' : 'Sign in to pick up where your curiosity left off.'}</p>
    <div className="auth-tabs"><button className={!register ? 'active' : ''} onClick={() => {setRegister(false); setError('');}}>Sign in</button><button className={register ? 'active' : ''} onClick={() => {setRegister(true); setError('');}}>Create account</button></div>
    <form className="form-stack" onSubmit={submit}>
      {register && <label>Your name<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} placeholder="First name or preferred name"/></label>}
      <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.edu" maxLength={254}/></label>
      <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} minLength={register ? 12 : undefined} required placeholder={register ? 'At least 12 characters' : 'Your password'} maxLength={128}/></label>
      <ErrorMessage message={error}/><SubmitButton loading={loading}>{register ? 'Create your account' : 'Sign in'}<ArrowRight size={17}/></SubmitButton>
    </form>
    <div className="privacy-note"><ShieldCheck size={17}/><span>Your interests stay private. No student directory, public profile, or social tracking.</span></div>
    <details className="demo-credentials"><summary>Try a local demo account</summary><p>Student: <code>student@demo.local</code><br/>Password: <code>StudentDemo2026!</code></p><p>Officer: <code>officer@demo.local</code><br/>Password: <code>OfficerDemo2026!</code></p><p>Available only with demo mode enabled. These accounts share sample data.</p></details>
  </Dialog>;
}

export function OnboardingDialog({user, onClose, onSave}: {user: User; onClose: () => void; onSave: (user: User) => void}) {
  const [interests, setInterests] = useState(user.interests); const [goals, setGoals] = useState(user.goals); const [campus, setCampus] = useState(user.campus || '');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true);
    try {onSave(await put<User>('/profile', {interests, goals, campus, onboarded: true}));} catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }
  return <Dialog title="Make room for your interests." onClose={onClose}><div className="onboarding-mark"><Sparkles size={27}/></div><p className="dialog-description">A few things you love help us find clubs you might love, too. Everything here is optional.</p><form className="form-stack" onSubmit={submit}>
    <fieldset><legend>What are you curious about?</legend><div className="interest-picker">{INTERESTS.map(interest => <button key={interest} className={`interest-option ${interests.includes(interest) ? 'chosen' : ''}`} type="button" aria-pressed={interests.includes(interest)} onClick={() => setInterests(interests.includes(interest) ? interests.filter(i => i !== interest) : [...interests, interest])}>{interests.includes(interest) && <Check size={13}/>} {interest}</button>)}</div></fieldset>
    <label>Home campus<select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>What would you like to get out of campus life?<textarea value={goals} onChange={e => setGoals(e.target.value)} maxLength={1000} placeholder="Meet people, try something creative, build a robot…" rows={3}/></label><ErrorMessage message={error}/><SubmitButton loading={loading}>Find my people<ArrowRight size={17}/></SubmitButton><button className="text-button centered" type="button" onClick={onClose}>I’ll explore on my own for now</button>
  </form></Dialog>;
}

export function ProfilePanel({user, onSave, onLogout, onDelete}: {user: User; onSave: (user: User) => void; onLogout: () => void; onDelete: () => void}) {
  const [name, setName] = useState(user.display_name); const [interests, setInterests] = useState(user.interests); const [goals, setGoals] = useState(user.goals); const [campus, setCampus] = useState(user.campus);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [deleting, setDeleting] = useState(false); const [confirm, setConfirm] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {e.preventDefault(); setError(''); setSaved(false); setLoading(true); try {onSave(await put<User>('/profile', {display_name: name, interests, goals, campus, onboarded: true})); setSaved(true);} catch (e) {setError((e as Error).message);} finally {setLoading(false);}}
  async function deleteAccount() {setLoading(true); setError(''); try {await api('/auth/me', {method: 'DELETE'}); onDelete();} catch (e) {setError((e as Error).message); setLoading(false);}}
  return <div className="profile-layout"><section className="surface profile-form"><div className="profile-intro"><span className="profile-avatar">{user.display_name.slice(0, 1).toUpperCase()}</span><div><h2>A little about you</h2><p>Change your interests as often as you change your mind.</p></div></div><form className="form-stack" onSubmit={submit}>
    <div className="form-columns"><label>Preferred name<input value={name} onChange={e => {setName(e.target.value); setSaved(false);}} required minLength={2} maxLength={80}/></label><label>Email<input value={user.email} disabled readOnly/></label></div>
    <label>Home campus<select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select></label>
    <fieldset><legend>Your interests</legend><div className="interest-picker">{INTERESTS.map(interest => <button key={interest} type="button" className={`interest-option ${interests.includes(interest) ? 'chosen' : ''}`} aria-pressed={interests.includes(interest)} onClick={() => setInterests(interests.includes(interest) ? interests.filter(i => i !== interest) : [...interests, interest])}>{interest}{interests.includes(interest) && <Check size={13}/>}</button>)}</div></fieldset>
    <label>Your campus goals<textarea value={goals} onChange={e => setGoals(e.target.value)} rows={4} maxLength={1000} placeholder="What are you hoping to find?"/></label><ErrorMessage message={error}/><div className="form-actions"><SubmitButton loading={loading}>Save preferences<Check size={17}/></SubmitButton>{saved && <span className="success-message" role="status">Preferences saved</span>}</div>
  </form></section><aside className="profile-aside"><div className="surface privacy-card"><ShieldCheck size={25}/><h3>Your space, your choice.</h3><p>Your profile is private. We use your interests and goals to suggest clubs. Suggestions can miss the mark; you can always explore the full directory.</p><p>We do not use sensitive traits, sell profile data, or track you across websites.</p><div className="mini-divider"/><p className="fine-print">Account type: {user.role}. This is a locally stored demo, with no official university connection.</p><button className="button button-outline full-width" onClick={onLogout}><LogOut size={16}/>Sign out</button></div><button className="delete-button" onClick={() => setDeleting(true)}><Trash2 size={15}/>Delete my account and data</button></aside>
    {deleting && <Dialog title="Delete your account?" onClose={() => setDeleting(false)}><p className="dialog-description">This permanently removes your profile, preferences, follows, saved events, and session. Type DELETE to confirm.</p><label className="form-stack">Confirmation<input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="DELETE"/></label><ErrorMessage message={error}/><button className="button button-danger full-width" disabled={confirm !== 'DELETE' || loading} onClick={deleteAccount}>Permanently delete account</button></Dialog>}
  </div>;
}
