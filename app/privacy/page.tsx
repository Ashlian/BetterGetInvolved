import type {Metadata} from 'next';
import './privacy.css';

export const metadata: Metadata = {
  title: 'Privacy Policy · ClRUb',
  description: 'What ClRUb collects when you sign in with your Rutgers ScarletMail account, how it is used, and how to delete it.',
};

// Set NEXT_PUBLIC_SUPPORT_EMAIL in Vercel (and .env locally); the address isn't kept in the code.
const CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
const UPDATED = 'November 24, 2026';

export default function PrivacyPage() {
  return <main className="legal-page">
    <a className="legal-back" href="/">← Back to ClRUb</a>
    <article>
      <header>
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated {UPDATED}</p>
        <p>ClRUb (clrub.vercel.app) helps Rutgers–New Brunswick students find clubs and events. It is an independent student project and is not affiliated with or endorsed by Rutgers University. This policy explains what ClRUb collects, why, who can see it, and how to delete it.</p>
      </header>

      <section>
        <h2>The short version</h2>
        <ul>
          <li>You can browse clubs and events without an account.</li>
          <li>Signing in uses your Rutgers ScarletMail Google account. ClRUb receives your name and ScarletMail address from Google, never your password.</li>
          <li>Your profile is private unless you choose to share it with other signed-in Rutgers students.</li>
          <li>ClRUb doesn’t sell your data, show ads, or use third-party analytics or tracking.</li>
          <li>You can delete your account and data at any time from Profile.</li>
        </ul>
      </section>

      <section>
        <h2>What we collect</h2>
        <h3>From Google, when you sign in</h3>
        <p>Your name, your ScarletMail email address, and Google’s account identifier for you, which keeps your account linked to the same Google login. ClRUb checks that the address is a verified <code>@scarletmail.rutgers.edu</code> account. It requests only basic sign-in information: it can’t read your email, files, contacts, or calendar.</p>
        <h3>What you add</h3>
        <ul>
          <li><strong>Profile:</strong> display name, optional username, bio, major, class year, home campus, interests, and profile photo, plus your “campus goals” text, which is used only for suggestions and never shown to others.</li>
          <li><strong>Activity:</strong> clubs you follow, save for later, or pass on; events you save or RSVP to; forum posts and comments; direct messages and questions to clubs; students you block; and reports you submit about content.</li>
          <li><strong>Club owners:</strong> edits to the clubs you manage, including logos and events.</li>
        </ul>
        <h3>Collected automatically</h3>
        <ul>
          <li><strong>A sign-in cookie</strong> that keeps you signed in for up to 7 days. The server stores only a scrambled (hashed) copy of it.</li>
          <li><strong>A browser setting</strong> that remembers whether you last used Discover or For you mode. It stays in your browser.</li>
          <li><strong>IP addresses</strong>, which ClRUb holds in memory for about a minute to limit abusive request rates. Our hosting provider also keeps standard request logs.</li>
        </ul>
      </section>

      <section>
        <h2>How we use it</h2>
        <ul>
          <li><strong>To run your account:</strong> signing you in, saving your follows, saves, RSVPs, and posts, and showing them on your profile.</li>
          <li><strong>To suggest clubs and events:</strong> your interests, major, goals, follows, saves, and passes are matched against club topics and descriptions. Suggestions are computed by the app itself. Your information isn’t sent to an outside AI service, and no “match scores” about you are created or shared.</li>
          <li><strong>To show contact details:</strong> club emails and Discord invites are shown only to signed-in students.</li>
          <li><strong>To keep the site safe:</strong> rate limiting and reviewing reported content.</li>
        </ul>
      </section>

      <section>
        <h2>Who can see what</h2>
        <ul>
          <li><strong>Forum posts and comments</strong> are public and show your display name.</li>
          <li><strong>Your profile</strong> is private by default: signed-in students who open it from your posts or messages see only your display name and any clubs you manage. If you set it to “Signed-in Rutgers students”, other signed-in students can see your name, username, photo, major, class year, campus, bio, interests, and recent forum posts. They never see your email, goals, follows, saves, or RSVPs.</li>
          <li><strong>Club managers</strong> are listed by display name on their club’s page for signed-in students.</li>
        <li><strong>Direct messages</strong> can be read by the two people in the conversation. <strong>Questions to a club</strong>, with your display name, can be read by everyone who manages that club now or later. Messages are stored in the app’s database and are not end-to-end encrypted; ClRUb’s operators could access them, for example to look into a report.</li>
        <li><strong>Notifications</strong> about comments, announcements, and events are visible only to you.</li>
        <li><strong>Club owners</strong> see totals only: how many people follow their club and save or RSVP to its events, never who.</li>
          <li><strong>“Followed together” links</strong> between clubs are only created when at least three people follow both clubs, so no individual’s follows can be worked out.</li>
        </ul>
      </section>

      <section>
        <h2>Services we rely on</h2>
        <p>ClRUb shares data with these service providers only as needed to run the site:</p>
        <ul>
          <li><strong>Google</strong> for sign-in.</li>
          <li><strong>Vercel</strong> for hosting.</li>
          <li><strong>Supabase</strong> for the database where your account and activity are stored.</li>
        </ul>
        <p>Club information comes from public student organization profiles on The Arc. Rutgers event listings come from Rutgers getINVOLVED and Rutgers Recreation through Scarlet Sync. None of your data is sent to those sources.</p>
        <p>ClRUb’s use of information received from Google APIs follows the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
      </section>

      <section>
        <h2>Keeping and deleting your data</h2>
        <p>Your data is kept while your account exists. To delete it, go to <strong>Profile → Privacy and account → Delete my account and data</strong>. That permanently removes your profile, photo, preferences, follows, saves, RSVPs, sign-in sessions, messages, notifications, and forum posts and comments. Your direct conversations, and questions you asked clubs, are removed for everyone in them. Deleting a post also removes other people’s replies to it. Copies may remain in routine database backups for a short time before they are overwritten.</p>
        <p>You can also edit or clear any profile field, remove your photo, make your profile private again, or stop new people from messaging you at any time.</p>
      </section>

      <section>
        <h2>Security</h2>
        <p>Connections use HTTPS. Sign-in cookies can’t be read by scripts, uploaded images are checked and served in a restricted way, and the database is reachable only by the app’s server. No system is perfectly secure, so please don’t share sensitive personal information in forums, messages, or profiles.</p>
      </section>

      <section>
        <h2>Who ClRUb is for</h2>
        <p>ClRUb is meant for Rutgers students. Signing in requires a Rutgers ScarletMail account, and ClRUb is not directed at children under 13.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>If this policy changes, the new version will be posted on this page with a new “Last updated” date.</p>
      </section>

      <section>
        <h2>Contact</h2>
        {CONTACT ? <p>Questions, requests, or concerns: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p> : <p>Contact details are being set up. Please check back soon.</p>}
      </section>
    </article>
  </main>;
}
