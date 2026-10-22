import {Code2, Flower2, Globe2, HeartHandshake, Leaf, Lightbulb, Music2, Palette, Rocket, Sparkles, Gamepad2, Microscope, type LucideIcon} from 'lucide-react';

export function categoryIcon(category: string): LucideIcon {
  if (/AI|Comput|Tech/i.test(category)) return Code2;
  if (/Volunteer|Service/i.test(category)) return HeartHandshake;
  if (/Art|Music/i.test(category)) return Palette;
  if (/Cultur/i.test(category)) return Globe2;
  if (/Outdoor|Recreation/i.test(category)) return Leaf;
  if (/Entrepreneur/i.test(category)) return Rocket;
  if (/Science/i.test(category)) return Microscope;
  if (/Well/i.test(category)) return Flower2;
  if (/Gam/i.test(category)) return Gamepad2;
  return Lightbulb;
}

export function ClubArt({category, color, variant = 0, large = false}: {category: string; color: string; variant?: number; large?: boolean}) {
  const Icon = categoryIcon(category);
  const palette = ['#ece9e2', '#e6eddf', '#eee3dc', '#e4e9ed', '#efe9d4', '#e8e1ed'];
  return <div className={`club-art art-${variant % 4} ${large ? 'art-large' : ''}`} style={{background: palette[variant % palette.length], '--art-color': color || '#cc0033'} as React.CSSProperties} aria-hidden="true">
    <div className="art-orbit"/><div className="art-block"/><div className="art-dot dot-one"/><div className="art-dot dot-two"/>
    <div className="art-icon"><Icon strokeWidth={1.35}/></div><Sparkles className="art-spark" strokeWidth={1.3}/>
    <span className="art-label">A LITTLE CURIOSITY. A LOT OF POSSIBILITY.</span>
  </div>;
}

export function HeroArtwork() {
  return <svg className="hero-artwork" viewBox="0 0 430 350" fill="none" role="img" aria-label="Illustration of students coming together, with a flower and a rising sun">
    <path d="M20 303C100 284 94 182 155 198C204 211 199 294 263 283C316 274 324 204 395 218" stroke="#8e9c80" strokeWidth="1.2" strokeDasharray="5 6"/>
    <circle cx="330" cy="94" r="49" fill="#e8bd60"/>
    <path d="M330 27V15M330 173V161M397 94H410M250 94H263M379 45L389 35M272 152L281 143M378 143L388 154M272 35L282 45" stroke="#d4aa4c" strokeWidth="2"/>
    <path d="M239 309V191C239 160 269 145 297 153C322 159 342 188 342 211V309H239Z" fill="#cc0033"/>
    <path d="M243 263L196 221L175 243L241 307L243 263Z" fill="#cc0033"/>
    <path d="M277 162C295 162 309 148 309 131C309 114 297 100 279 101C261 101 249 115 249 132C249 149 260 162 277 162Z" fill="#c58a63"/>
    <path d="M249 131C238 93 263 78 281 81C308 82 322 103 309 137L300 116C279 125 267 107 267 107L249 131Z" fill="#273c33"/>
    <path d="M257 307V221M328 309V234" stroke="#8d0021" strokeWidth="2"/>
    <path d="M91 309V217C91 183 120 166 148 172C176 177 189 197 189 227V309H91Z" fill="#e8bf60"/>
    <path d="M181 219L218 195L229 218L187 254L181 219Z" fill="#e8bf60"/>
    <path d="M138 182C155 182 168 169 168 151C168 134 155 122 138 122C121 122 107 134 107 152C107 169 121 182 138 182Z" fill="#dab08b"/>
    <path d="M104 156C90 132 107 104 130 106C150 95 177 116 171 140L157 135L154 123L143 137L118 137L112 160L104 156Z" fill="#352e29"/>
    <path d="M105 309V240M176 309V250" stroke="#b99543" strokeWidth="2"/>
    <path d="M216 202L222 193C227 186 233 194 228 200L219 211" fill="#c58a63"/>
    <path d="M181 229L173 223C168 219 164 224 170 231L179 239" fill="#dab08b"/>
    <path d="M40 310H385" stroke="#273c33" strokeWidth="2"/>
    <path d="M57 212V158M57 183C29 181 35 162 57 172M57 195C80 193 82 174 57 184" stroke="#7f9377" strokeWidth="3"/>
    <path d="M57 157C34 164 34 146 49 145C37 127 53 122 60 137C68 119 83 129 73 143C91 144 84 160 67 155C68 171 53 172 57 157Z" fill="#cc0033"/>
    <circle cx="61" cy="148" r="5" fill="#e8bf60"/>
    <path d="M204 78L210 93L226 99L211 105L204 121L198 105L183 99L198 93L204 78Z" fill="#273c33"/>
    <path d="M360 260L364 269L375 273L364 277L360 288L356 277L346 273L356 269L360 260Z" fill="#7f9377"/>
    <circle cx="100" cy="73" r="4" fill="#cc0033"/>
    <path d="M371 180C379 173 389 175 392 183" stroke="#273c33" strokeWidth="2" strokeLinecap="round"/>
  </svg>;
}
