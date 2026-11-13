# Shared implementation contract

All endpoints start `/api`. A Next.js route handler forwards to FastAPI on 127.0.0.1:8000 (or runtime `API_URL`). JSON, snake_case fields. Use same-origin HTTP-only session cookies; frontend fetch includes credentials. Responses below describe exact public shapes. Errors use `detail` string. IDs are strings.

- GET /health -> {status, data_mode, embedding_model}
- GET /clubs?q=&campus=&category=&beginner= -> Club[] (search handles natural language constraints)
- GET /clubs/{id} -> Club
- GET /recommendations?limit=8 -> {clubs: RecommendedClub[], method: string}
- GET /events?q=&campus=&club_id=&from_date=&to_date= -> Event[]
- GET /events/{id} -> Event
- POST /clubs/{id}/faq {question} -> {answer, sources: [{title,url,excerpt}], supported: boolean, method: string}
- GET /auth/me -> User (401 if signed out)
- POST /auth/register {email,password,display_name} -> User, sets cookie
- POST /auth/login {email,password} -> User, sets cookie
- POST /auth/logout -> {ok:true}, clears cookie
- DELETE /auth/me -> {ok:true}, deletes user data/session
- PUT /profile {display_name?,interests?,goals?,campus?,onboarded?} -> User
- GET /saved -> {club_ids: string[], event_ids: string[], dismissed_ids: string[], maybe_later_ids: string[], rsvps: Record<string,'interested'|'going'>}
- POST /clubs/{id}/follow -> {following:boolean}
- POST /clubs/{id}/bookmark -> {bookmarked:boolean} (private maybe-later list)
- POST /clubs/{id}/dismiss -> {dismissed:boolean}
- POST /events/{id}/save -> {saved:boolean}
- POST /events/{id}/rsvp {status:'interested'|'going'|'none'} -> {status}
- GET /events/{id}/calendar -> downloadable ICS
- POST /reports {kind:'club'|'event'|'answer'|'forum_post'|'forum_comment',target_id,reason} -> {ok:true}
- GET /officer/clubs -> Club[] (authorized assigned clubs only)
- POST /officer/events {club_id,title,description,starts_at,ends_at,campus,location,category,cost,beginner_friendly,registration_url?,accessibility?} -> Event
- PATCH /officer/events/{id} same optional fields + status ('scheduled'|'cancelled') -> Event
- PUT /officer/clubs/{id} editable club profile fields -> Club
- GET /officer/analytics -> {clubs: [{club_id,name,follows,saved_events,rsvps,events}], note:string}

Club = {id, name, short_name, category, description, mission, interests:string[], campus, location, meeting_schedule, beginner_friendly:boolean, membership_fee:string, eligibility, contact_email, website, instagram?, discord?, faqs:[{question,answer}], source_url, updated_at, verification:'demo'|'unclaimed'|'verified', color, featured:boolean}

RecommendedClub extends Club with {score:number, explanation:string}

Event = {id,club_id,club_name,title,description,starts_at:string ISO8601 with timezone,ends_at:string,campus,location,category,cost:number,beginner_friendly:boolean,registration_url:string,accessibility:string,source_url,updated_at,status:'scheduled'|'cancelled',is_demo:boolean}

User = {id,email,display_name,role:'student'|'officer'|'admin',interests:string[],goals:string,campus:string,onboarded:boolean}

## Club forums

- GET /forums?q=&club_id=&sort=newest|active -> ForumPost[] (guest-readable; first 100 matches after filtering and sorting)
- GET /forums/{post_id} -> ForumThread (guest-readable; up to 1000 comments)
- POST /forums {club_id,title,body} -> ForumPost (201, signed in)
- POST /forums/{post_id}/comments {body} -> ForumComment (201, signed in)
- DELETE /forums/{post_id} -> {ok:true} (author or platform admin)
- DELETE /forums/{post_id}/comments/{comment_id} -> {ok:true} (comment author or platform admin)

ForumPost = {id,club_id,club_name,title,body,author_name,created_at,updated_at,comment_count,can_delete:boolean}

ForumComment = {id,post_id,body,author_name,created_at,can_delete:boolean}

ForumThread extends ForumPost with {comments:ForumComment[]}. Titles contain 3–160 characters; post bodies 1–10000; comments 1–3000. Whitespace-only submissions are rejected. All text is plain text. Search matches post titles, bodies, and the linked club's name. Authors' current display names are public; emails, account identifiers, and private profile fields are excluded. Public responses include viewer-specific ownership flags and are not cached. Account, club, and post removal cascade to dependent forum content. Discussions are stored in `forum_posts` and `forum_comments` using the existing SQLite/Postgres storage interface.

Threads reject additional comments at 1000 with a descriptive 409 response; clients keep the draft and offer a new discussion. Forum writes are limited to 30 per minute by the existing request limiter. Creating a post requires an existing club. Reporting and deletion validate the target before acting; deleting a comment also verifies its parent post.

Seed data is shared as data/seed.json {clubs:Club[],events:Event[]}. 24+ explicitly labeled fictitious demo clubs/events. No false Rutgers verification or real attendance figures. Dates anchored to Oct 22 2026; UI should display exact dates and not claim currently happening. Backend supports DEMO_REFERENCE_DATE for reproducible eval.

Initial MVP runs locally with SQLite and local semantic embeddings (TF-IDF + latent semantic analysis); document limitations. No external API key needed; real student research and production data integrations are outstanding. Officer demo access is created only when DEMO_MODE=1; backend agent documents exact fixture credentials. Student registration never grants officer privileges. Do not deploy publicly with demo credentials.
