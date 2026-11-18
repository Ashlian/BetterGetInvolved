"""Campus topic vocabulary: the concept layer of the club knowledge graph.

Each topic is a node ("topic:<key>") with the words students actually use for it and the
broader topics it belongs to. Clubs link to the topics their name and description mention,
and a search query is mapped onto the same topics, so "pickup basketball" and "I'm premed and
want to volunteer" reach clubs that never use those exact words. This is a hand-written,
inspectable vocabulary, not a language model; extend it here and the graph rebuilds itself.

Matching works on lightly stemmed words, longest phrase first: in "West Indian Student
Organization", "west indian" is consumed as one phrase, so "indian" alone never fires.
"""

import hashlib
import json
import re

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

# key: (label, keywords and phrases, broader topic keys)
TOPICS = {
    # Games and fandoms
    "games": ("Games", ["game", "games", "gaming", "gamer", "play games"], []),
    "video-games": ("Video games", ["video game", "videogame", "esports", "e sports", "esport", "league of legends", "valorant", "overwatch", "minecraft", "roblox", "genshin", "splatoon", "pokemon", "marvel rivals", "among us", "nintendo", "playstation", "xbox", "console", "pc gaming", "supercell", "identity v", "rhythm game", "smash", "smash bros", "fps"], ["games"]),
    "board-games": ("Board and card games", ["board game", "tabletop", "card game", "card games", "poker", "magic the gathering", "yugioh", "yu gi oh", "dungeons", "dragons", "dnd", "d and d", "tcg", "trading card", "mahjong", "puzzle", "puzzles"], ["games"]),
    "chess": ("Chess", ["chess"], ["board-games"]),
    "game-dev": ("Game development", ["game development", "game design", "game dev", "gamedev", "unity", "unreal", "make games", "making games", "create games", "creating games"], ["video-games", "programming"]),
    "anime": ("Anime and cosplay", ["anime", "manga", "cosplay", "cosplayer", "otaku", "japanese animation", "vtuber"], ["pop-culture", "japanese"]),
    "pop-culture": ("Fandoms and pop culture", ["fandom", "fan club", "comic", "comics", "comic book", "marvel", "harry potter", "quidditch", "furry", "furries", "superhero", "taylor swift", "swifties", "tv show", "reality tv", "kdrama", "k drama"], []),
    # Sports and fitness
    "sports": ("Sports", ["sport", "sports", "club sport", "athletic", "athletics", "athlete", "intramural", "pickup", "pick up game", "team sport", "recreation"], []),
    "basketball": ("Basketball", ["basketball", "hoops"], ["sports"]),
    "soccer": ("Soccer", ["soccer", "futbol", "futsal"], ["sports"]),
    "volleyball": ("Volleyball", ["volleyball", "beach volleyball", "roundnet", "spikeball"], ["sports"]),
    "racquet-sports": ("Racquet sports", ["tennis", "table tennis", "ping pong", "badminton", "squash", "pickleball", "racquet", "racket"], ["sports"]),
    "hockey": ("Hockey", ["hockey", "ice hockey", "field hockey"], ["sports"]),
    "football-rugby": ("Football and rugby", ["football", "flag football", "rugby", "american football"], ["sports"]),
    "baseball-cricket": ("Baseball, softball and cricket", ["baseball", "softball", "cricket"], ["sports"]),
    "field-sports": ("Lacrosse, ultimate and more", ["lacrosse", "ultimate frisbee", "frisbee", "quadball"], ["sports"]),
    "water-sports": ("Swimming and water sports", ["swim", "swimming", "swimmer", "water polo", "diving", "sailing", "sail", "surfing", "surf", "rowing", "crew", "kayak", "kayaking", "canoe", "boat", "boating"], ["sports"]),
    "running": ("Running", ["track and field", "running", "runner", "run club", "marathon", "half marathon", "cross country", "jog", "jogging", "5k"], ["sports", "fitness"]),
    "winter-sports": ("Skiing and skating", ["ski", "skiing", "snowboard", "snowboarding", "skating", "figure skating", "ice skating", "roller skating", "skate", "skateboarding"], ["sports"]),
    "martial-arts": ("Martial arts and combat sports", ["martial arts", "martial art", "karate", "judo", "jiu jitsu", "jujitsu", "bjj", "taekwondo", "tae kwon do", "kendo", "aikido", "wushu", "kung fu", "ving tsun", "wing chun", "boxing", "kickboxing", "mma", "self defense", "wrestling", "fencing", "muay thai", "kodenkan"], ["sports"]),
    "fitness": ("Fitness and lifting", ["lifting weights", "fitness", "gym", "weightlifting", "powerlifting", "bodybuilding", "calisthenics", "workout", "workouts", "exercise", "muscle", "strength training", "crossfit", "physique"], ["health"]),
    "gymnastics": ("Gymnastics and tricking", ["gymnastics", "gymnast", "tricking", "acrobatics", "parkour", "flips", "cheer", "cheerleading"], ["sports"]),
    "precision-sports": ("Golf, bowling, archery and billiards", ["golf", "bowling", "archery", "billiards", "pool", "darts", "paintball", "airsoft", "disc golf"], ["sports"]),
    "equestrian": ("Horses and riding", ["horseback riding", "horse riding", "equestrian", "horse", "horses", "horseback", "mounted"], ["sports", "animals"]),
    "outdoors": ("Outdoors and adventure", ["the outdoors", "outdoor", "outdoors", "hike", "hiking", "hiker", "camping", "backpacking", "trail", "trails", "climbing", "rock climbing", "bouldering", "birdwatching", "birding", "fishing", "hunting", "adventure", "national park"], []),
    # Arts, music and performance
    "arts": ("Arts", ["art", "arts", "artist", "artists", "artistic", "creative", "creativity"], []),
    "music": ("Music", ["music", "musical", "musician", "musicians", "band", "song", "songs", "concert", "jam", "jam session", "composer"], ["arts"]),
    "singing": ("Singing and a cappella", ["sing", "singing", "singer", "singers", "choir", "choral", "chorus", "a cappella", "acapella", "vocal", "vocals", "glee", "karaoke", "harmony", "gospel"], ["music", "performing-arts"]),
    "instruments": ("Instruments and bands", ["instrument", "instruments", "guitar", "guitarist", "piano", "pianist", "violin", "cello", "drum", "drums", "drummer", "dhol", "brass", "orchestra", "symphony", "jazz", "string", "strings", "ukulele", "saxophone", "marching band"], ["music"]),
    "music-production": ("DJing and music production", ["music producer", "dj", "djing", "music production", "beat making", "beats", "music technology", "audio", "sound design", "radio", "edm"], ["music"]),
    "dance": ("Dance", ["dance", "dancing", "dancer", "dancers", "choreography", "dance troupe", "dance team", "dance crew", "bhangra", "garba", "raas", "kpop dance", "ballroom", "salsa", "bachata", "swing dance", "bellydance", "belly dance", "breakdance", "breaking", "bboy", "b boy", "irish dance", "cumbia", "bharatanatyam", "kathak", "classical dance", "stepping", "step team", "tango", "ballet", "hip hop dance", "contemporary dance", "folk dance"], ["performing-arts"]),
    "theatre": ("Theatre and comedy", ["improv comedy", "improv team", "improv troupe", "improvisational", "acting class", "acting troupe", "stage acting", "theatre", "theater", "actress", "musical theatre", "drama", "comedy", "comedian", "stand up", "sketch comedy", "cabaret", "puppet", "puppetry", "voice acting", "playwriting", "screenwriting"], ["performing-arts"]),
    "performing-arts": ("Performing arts", ["perform", "performance", "performances", "performing", "performer", "showcase", "recital", "talent show"], ["arts"]),
    "visual-arts": ("Visual arts and design", ["fashion design", "interior design", "painting", "paint", "drawing", "draw", "sketching", "sculpture", "ceramics", "pottery", "illustration", "illustrator", "studio art", "graphic design", "animation", "animator", "digital art", "art history", "museum", "gallery"], ["arts"]),
    "crafts": ("Crafts", ["craft", "crafts", "crafting", "knitting", "knit", "crochet", "sewing", "stitch", "stitching", "origami", "jewelry", "beading", "diy", "nail art", "embroidery", "scrapbooking"], ["arts"]),
    "film-photo": ("Film and photography", ["film", "films", "filmmaking", "filmmaker", "movie", "movies", "cinema", "video production", "videography", "photography", "photographer", "photo", "photos", "camera", "youtube", "short film"], ["arts", "media"]),
    "writing": ("Writing and books", ["writing", "writer", "writers", "write", "poetry", "poem", "poems", "poet", "literature", "literary", "book", "books", "book club", "novel", "novels", "fiction", "creative writing", "spoken word", "slam poetry", "zine", "anthology", "storytelling", "fanfiction"], ["arts"]),
    "media": ("Journalism and media", ["journalism", "journalist", "news", "newspaper", "reporting", "reporter", "magazine", "publication", "radio", "podcast", "podcasting", "broadcast", "broadcasting", "media", "public relations", "editorial", "editor", "blog", "content creation", "content creator", "social media"], []),
    "fashion": ("Fashion and beauty", ["modeling team", "fashion model", "fashion", "clothing", "clothes", "runway", "beauty", "makeup", "skincare", "hair", "curly hair", "natural hair", "nails", "thrift", "thrifting", "streetwear"], []),
    "food": ("Food and cooking", ["food", "foods", "cooking", "baking", "bake", "baker", "recipe", "recipes", "cuisine", "culinary", "chef", "foodie", "restaurant", "restaurants", "coffee", "tea", "boba", "cheese", "snack", "snacks", "eating", "tasting", "food science"], []),
    # Culture, heritage and language
    "culture": ("Culture and heritage", ["culture", "cultural", "heritage", "diaspora", "tradition", "traditions", "international students", "international student", "multicultural"], []),
    "asian": ("Asian and Asian American", ["asian", "asian american", "pan asian", "aapi", "apida"], ["culture"]),
    "south-asian": ("South Asian", ["south asian", "desi", "indian", "india", "pakistani", "pakistan", "bangladeshi", "bangladesh", "bengali", "bangla", "nepali", "nepal", "sri lankan", "punjabi", "gujarati", "marathi", "tamil", "telugu", "kannada", "malayali", "kerala", "kashmiri", "hindi", "urdu", "bollywood", "bhangra", "garba", "raas", "south indian"], ["asian"]),
    "east-asian": ("East Asian", ["east asian", "chinese", "china", "mandarin", "cantonese", "taiwanese", "taiwan", "hong kong", "japanese", "japan", "korean", "korea", "kpop", "k pop", "tibet", "tibetan", "mongolian"], ["asian"]),
    "korean": ("Korean", ["korean", "korea", "kpop", "k pop", "kdrama", "k drama", "hangul"], ["east-asian"]),
    "chinese": ("Chinese", ["chinese", "china", "mandarin", "cantonese", "taiwanese", "taiwan", "hong kong"], ["east-asian"]),
    "japanese": ("Japanese", ["japanese", "japan", "nihongo"], ["east-asian"]),
    "southeast-asian": ("Southeast Asian", ["southeast asian", "filipino", "filipina", "philippine", "philippines", "pilipino", "vietnamese", "vietnam", "thai", "thailand", "indonesian", "malaysian", "cambodian", "khmer", "hmong", "lao", "burmese"], ["asian"]),
    "middle-eastern": ("Middle Eastern and North African", ["middle eastern", "middle east", "arab", "arabic", "palestinian", "palestine", "egyptian", "egypt", "persian", "iranian", "iran", "turkish", "turkey", "turkic", "kurdish", "lebanese", "syrian", "north african", "swana", "armenian", "georgian", "afghan", "western asian", "moroccan", "algerian"], ["culture"]),
    "african": ("African", ["african", "africa", "nigerian", "nigeria", "ghanaian", "ghana", "ethiopian", "eritrean", "kenyan", "somali", "sudan", "sudanese", "congolese", "cameroonian", "afrobeats"], ["culture", "black"]),
    "caribbean": ("Caribbean and West Indian", ["caribbean", "west indian", "west indies", "haitian", "haiti", "jamaican", "jamaica", "trinidadian", "guyanese", "dominican", "puerto rican", "puertorriquena", "cuban"], ["culture"]),
    "indigenous": ("Indigenous and Native American", ["indigenous", "native american", "american indian", "first nations", "native students"], ["culture"]),
    "black": ("Black community", ["black", "african american", "afro", "naacp", "black student", "black students", "black women", "black men"], ["culture"]),
    "latin-american": ("Latin American and Latinx", ["latino", "latina", "latinx", "latine", "latin", "hispanic", "latin american", "latinoamerica", "mexican", "mexico", "dominican", "puerto rican", "colombian", "peruvian", "salvadoran", "ecuadorian", "ecuador", "brazilian", "brazil", "cuban", "chicano", "chicana", "venezuelan", "guatemalan", "honduran", "bachata", "salsa", "cumbia", "spanish speaking"], ["culture"]),
    "european": ("European", ["european", "europe", "italian", "italy", "irish", "ireland", "polish", "poland", "russian", "russia", "ukrainian", "ukraine", "albanian", "greek", "hellenic", "french", "france", "german", "germany", "portuguese", "eastern european", "balkan"], ["culture"]),
    "languages": ("Languages", ["conversation practice", "conversation table", "language", "languages", "language exchange", "conversation club", "fluent", "fluency", "bilingual", "linguistics", "sign language", "asl", "mandarin", "cantonese", "spanish", "french", "hebrew", "hindi", "urdu", "sanskrit", "samskritam", "arabic", "korean language", "japanese conversation"], []),
    # Faith
    "faith": ("Faith and spirituality", ["faith", "religion", "religious", "spiritual", "spirituality", "prayer", "pray", "interfaith", "worship", "god", "belief", "ministry", "scripture"], []),
    "christian": ("Christian", ["christian", "christians", "christ", "jesus", "church", "bible", "bible study", "gospel", "catholic", "episcopal", "orthodox christian", "fellowship", "evangelical", "protestant", "adventist", "cru", "chi alpha", "intervarsity", "young life", "campus ministry", "reformed"], ["faith"]),
    "jewish": ("Jewish", ["jewish", "jews", "judaism", "hillel", "chabad", "hebrew", "israel", "israeli", "shabbat", "kosher", "torah"], ["faith"]),
    "muslim": ("Muslim", ["muslim", "muslims", "islam", "islamic", "quran", "mosque", "jummah", "jumuah", "jumu ah", "ramadan", "ahlul bayt", "halal"], ["faith"]),
    "dharmic": ("Hindu, Sikh, Jain and Buddhist", ["hindu", "hindus", "hinduism", "dharma", "bhakti", "baps", "sikh", "sikhs", "sikhism", "jain", "jains", "jainism", "buddhist", "buddhism", "vedic", "krishna", "yuva"], ["faith"]),
    "mindfulness": ("Meditation and mindfulness", ["meditation", "meditate", "mindfulness", "mindful", "yoga", "breathing", "inner peace"], ["mental-health"]),
    # Identity and community
    "lgbtq": ("LGBTQ+", ["pride month", "lgbt", "lgbtq", "lgbtqia", "lgbtqqia", "queer", "gay", "lesbian", "bisexual", "trans", "transgender", "nonbinary", "non binary", "aro", "asexual", "aromantic", "gender identity", "sexuality"], []),
    "women": ("Women's groups", ["women", "woman", "womxn", "female", "females", "girl", "girls", "sisterhood", "sister", "sisters", "feminist", "feminism", "women in"], []),
    "first-gen": ("First-gen, transfer and commuter students", ["first generation", "first gen", "firstgen", "educational opportunity", "eop", "low income", "transfer student", "transfer students", "commuter", "commuters", "commute", "commuting"], []),
    "military": ("Military and veterans", ["veteran", "veterans", "military", "rotc", "army", "navy", "air force", "marine", "marines", "service members"], []),
    "disability": ("Disability and neurodiversity", ["disability", "disabilities", "disabled", "neurodiversity", "neurodivergent", "autism", "autistic", "adhd", "accessibility", "deaf", "blind", "special needs", "best buddies", "unified sports", "intellectual and developmental"], []),
    "graduate": ("Graduate students", ["masters students", "masters degree", "graduate student", "graduate students", "grad student", "grad students", "phd", "doctoral", "graduate organization", "gso"], []),
    "social": ("Making friends", ["make friends", "making friends", "meet people", "meeting people", "meet new people", "new friends", "friends", "friendship", "hang out", "hangout", "hanging out", "socialize", "social events", "chill", "lonely"], []),
    # Service and causes
    "volunteering": ("Volunteering and service", ["volunteer", "volunteers", "volunteering", "community service", "service project", "service projects", "service trip", "serve the community", "charity", "charities", "nonprofit", "non profit", "fundraise", "fundraiser", "fundraising", "donate", "donation", "donations", "philanthropy", "mutual aid", "outreach", "habitat", "alternative break", "food bank", "food pantry", "hunger", "homeless", "homelessness", "humanitarian", "relief", "dance marathon", "give back", "giving back"], []),
    "kids-education": ("Kids, tutoring and education", ["teaching kids", "student teaching", "k 12", "elementary school", "middle school", "high school", "childhood literacy", "reading to kids", "future teachers", "children", "kids", "child", "youth", "pediatric", "tutor", "tutoring", "educator", "camp kesem", "big buddy"], []),
    "animals": ("Animals", ["animal", "animals", "pet", "pets", "dog", "dogs", "cat", "cats", "puppy", "puppies", "wildlife", "veterinary", "veterinarian", "pre vet", "zoo", "primate", "primates", "birds", "insects", "entomology", "bugs", "animal rights", "animal welfare"], []),
    "environment": ("Environment and climate", ["the environment", "protect the environment", "environmentalism", "environmental", "climate", "climate change", "sustainability", "sustainable", "green", "ecology", "conservation", "renewable", "renewable energy", "recycling", "recycle", "carbon", "clean energy", "pollution", "plastic", "zero waste", "garden", "gardening", "composting", "compost", "plants", "plant science", "forest", "forestry", "ocean", "oceans", "coastal", "earth"], []),
    "activism": ("Activism and social justice", ["civil rights", "activism", "activist", "activists", "advocacy", "advocate", "advocates", "social justice", "justice", "human rights", "equity", "equality", "protest", "reform", "anti racism", "antiracism", "immigrant", "immigrants", "immigration", "refugee", "refugees", "undocumented", "workers rights", "labor", "liberation", "solidarity", "inequality", "inequities", "reproductive rights", "pro life", "pro choice", "abolition"], []),
    "politics": ("Politics and government", ["free speech", "politics", "political", "government", "policy", "public policy", "election", "elections", "vote", "voting", "voter", "democrat", "democrats", "democratic", "republican", "republicans", "progressive", "conservative", "libertarian", "campaign", "civic", "civics", "legislation"], []),
    "global": ("Global affairs", ["international affairs", "international relations", "foreign service", "foreign policy", "diplomacy", "diplomat", "united nations", "model un", "model united nations", "unicef", "study abroad", "international development", "global health", "geopolitics"], ["politics"]),
    "law": ("Law and pre-law", ["supreme court", "law", "legal", "lawyer", "lawyers", "attorney", "pre law", "prelaw", "lsat", "law school", "mock trial", "moot court", "courtroom", "criminal justice", "paralegal"], []),
    "debate-speech": ("Debate and public speaking", ["debate", "debates", "debating", "public speaking", "speech", "speeches", "toastmasters", "ethics bowl", "rhetoric", "quiz bowl", "academic team", "trivia", "ted", "tedx"], []),
    "leadership": ("Leadership and student government", ["leadership", "student government", "governing council", "student assembly", "honor society", "honors society", "residence hall", "allocations board", "student council"], []),
    # Health
    "health": ("Health and wellness", ["health", "healthy", "wellness", "wellbeing", "well being", "public health", "disease", "diseases", "cancer", "nutrition", "nutritional", "diet", "sleep", "sexual health", "healthcare", "health care"], []),
    "medicine": ("Pre-health and medicine", ["patient care", "premed", "pre med", "premedical", "pre medical", "pre health", "prehealth", "medicine", "medical", "doctor", "doctors", "physician", "physicians", "mcat", "med school", "medical school", "clinical", "clinic", "hospital", "hospitals", "surgery", "surgeon", "surgical", "emt", "shadowing", "global surgery", "radiology"], ["health"]),
    "dental": ("Pre-dental", ["dental", "dentist", "dentistry", "pre dental", "predental", "oral health"], ["health"]),
    "pharmacy": ("Pharmacy", ["pharmacy", "pharmacist", "pharmacists", "pharmaceutical", "pharmaceutics", "pharmd", "pharmacology", "drug", "drugs"], ["health"]),
    "allied-health": ("Nursing, PA, PT and other health careers", ["nursing", "nurse", "nurses", "pre nursing", "physician assistant", "pre pa", "pa school", "physical therapy", "physical therapist", "occupational therapy", "pre ot", "optometry", "speech pathology", "audiology", "kinesiology", "sports medicine", "athletic training", "genetic counseling", "public health"], ["health"]),
    "mental-health": ("Mental health", ["mental health", "mental wellness", "mental illness", "therapy", "counseling", "anxiety", "depression", "stress", "suicide prevention", "self care", "self love", "peer support", "emotional"], ["health"]),
    # Science, tech and engineering
    "science": ("Science and research", ["science", "sciences", "scientific", "scientist", "scientists", "research", "researcher", "researchers", "lab", "labs", "laboratory", "stem", "experiment", "experiments"], []),
    "biology": ("Biology and life sciences", ["biology", "biological", "biochemistry", "molecular", "genetics", "genetic", "genomics", "microbiology", "cell biology", "biotech", "biotechnology", "ecology", "evolution", "biomedical", "bioinformatics", "computational biology", "toxicology", "plant science", "animal science", "biosciences"], ["science"]),
    "chemistry": ("Chemistry", ["chemistry", "chemical", "chemist", "organic chemistry", "biochemistry"], ["science"]),
    "physics-space": ("Physics, space and astronomy", ["outer space", "space exploration", "space technology", "nasa", "nuclear fusion", "fusion energy", "physics", "physicist", "astronomy", "astrophysics", "telescope", "stargazing", "planets", "nuclear", "optics", "photonics", "quantum", "cosmology", "space exploration", "satellite", "satellites"], ["science"]),
    "earth-science": ("Earth, ocean and weather", ["geology", "geologist", "rocks", "minerals", "oceanography", "marine", "marine biology", "meteorology", "weather", "storm", "storms", "geography", "geographic", "maps", "gis", "earth science", "climate science"], ["science", "environment"]),
    "neuro-psych": ("Psychology and neuroscience", ["psychology", "psych", "psychological", "neuroscience", "neuro", "brain", "brains", "cognitive", "cognitive science", "cogsci", "behavior", "behavioral", "psychedelic", "psychedelics"], ["science"]),
    "math": ("Math and statistics", ["math", "maths", "mathematics", "mathematical", "statistics", "statistical", "actuarial", "actuary", "quantitative", "quant", "probability", "proofs", "operations research"], ["science"]),
    "tech": ("Technology", ["tech", "technology", "technologies", "computer", "computers", "computing", "digital", "information technology", "startup tech", "tech industry"], []),
    "programming": ("Coding and software", ["software developer", "web developer", "learn to code", "write code", "coding", "coder", "coders", "programming", "programmer", "programmers", "software", "software engineering", "software engineer", "app development", "web development", "web dev", "mobile app", "mobile apps", "app", "apps", "hackathon", "hackathons", "hack", "computer science", "computer scientist", "computer scientists", "cs", "linux", "open source", "github", "python", "java", "javascript", "leetcode", "competitive programming", "algorithms", "cloud computing", "cloud", "swe", "full stack", "frontend", "backend"], ["tech"]),
    "ai-data": ("AI and data science", ["ai", "artificial intelligence", "machine learning", "ml", "deep learning", "data science", "data scientist", "data", "analytics", "data analytics", "neural network", "neural networks", "llm", "llms", "chatgpt", "computer vision", "nlp", "big data"], ["tech"]),
    "cybersecurity": ("Cybersecurity", ["security club", "information security", "cybersecurity", "cyber security", "cyber", "infosec", "ctf", "capture the flag", "ethical hacking", "penetration testing", "hacking"], ["tech"]),
    "blockchain": ("Blockchain and crypto", ["blockchain", "crypto", "cryptocurrency", "web3", "bitcoin", "ethereum", "defi", "nft"], ["tech", "finance"]),
    "product-design": ("Product and UX", ["product management", "product manager", "ux", "ui", "user experience", "user interface", "ux design", "design thinking", "figma"], ["tech"]),
    "engineering": ("Engineering", ["civil engineers", "materials engineering", "materials science", "engineer", "engineers", "engineering", "mechanical engineering", "electrical engineering", "civil engineering", "chemical engineering", "biomedical engineering", "aerospace", "aeronautics", "aeronautical", "industrial engineering", "systems engineering", "manufacturing", "packaging", "cad", "hardware", "circuits", "electronics", "ieee", "asme", "plastics", "railway"], ["tech", "science"]),
    "robotics-making": ("Robotics and building things", ["robot", "robots", "robotics", "drone", "drones", "3d printing", "3d printer", "3d print", "makerspace", "arduino", "raspberry pi", "prosthetic", "prosthetics", "solar car", "formula racing", "race car", "electric boat", "rocket", "rockets", "rocketry", "build things", "building things", "fabrication", "soldering"], ["engineering"]),
    "aviation": ("Aviation", ["pilot license", "flight training", "aviation", "flying", "flight", "airplane", "airplanes", "aircraft", "aerospace"], ["physics-space"]),
    "cars": ("Cars and motorsport", ["car", "cars", "automotive", "car racing", "motorsport", "motorsports", "formula", "vehicle", "vehicles"], []),
    # Business and careers
    "careers": ("Careers and networking", ["career", "careers", "job", "jobs", "internship", "internships", "intern", "resume", "resumes", "networking", "network", "recruiting", "recruiter", "recruiters", "interview", "interviews", "professional development", "linkedin", "employer", "employers", "industry professionals", "get hired", "full time"], []),
    "business": ("Business", ["business management", "project management", "business", "businesses", "corporate", "supply chain", "human resources", "hr", "shrm", "retail", "business school"], ["careers"]),
    "finance": ("Finance and investing", ["financial literacy", "finance", "financial", "investing", "investment", "investments", "invest", "investor", "stock", "stocks", "stock market", "trading", "trader", "wall street", "banking", "investment banking", "private equity", "hedge fund", "venture capital", "personal finance", "budgeting", "accounting", "accountant", "cpa", "real estate", "valuation", "economics", "economy", "econ"], ["business"]),
    "entrepreneurship": ("Startups and entrepreneurship", ["start a business", "starting a business", "start my own", "own business", "start a company", "business plan", "entrepreneur", "entrepreneurs", "entrepreneurship", "entrepreneurial", "startup", "startups", "start up", "founder", "founders", "venture", "ventures", "pitch", "pitching", "pitch competition", "business idea", "incubator", "small business", "side hustle", "enactus"], ["business"]),
    "marketing-consulting": ("Marketing and consulting", ["consulting", "consultant", "consultants", "case competition", "marketing", "marketer", "advertising", "brand", "branding", "public relations", "sales"], ["business"]),
    # Humanities
    "history": ("History", ["history", "historical", "historian", "medieval", "reenactment", "archaeology", "archaeological", "classics", "ancient", "antiquity"], []),
    "philosophy": ("Philosophy and ethics", ["philosophy", "philosophical", "philosopher", "ethics", "ethical", "bioethics", "logic", "existential", "thomistic", "metaphysics"], []),
    "social-sciences": ("Social sciences", ["sociology", "anthropology", "social work", "social science", "urban planning", "public administration", "criminology", "economics"], []),
}

# Topics so broad that they only nudge results.
SOFT = {"social": 0.35, "culture": 0.6, "arts": 0.7, "science": 0.7, "tech": 0.7, "health": 0.7, "games": 0.8, "sports": 0.8, "careers": 0.7, "faith": 0.8,
        "leadership": 0.5, "performing-arts": 0.7}
# Everyday phrases that contain a topic word but are not about the topic. They are consumed
# whole, so "safe space" never counts as astronomy and "code of conduct" never as coding.
IGNORE = ["safe space", "welcoming environment", "inclusive environment", "supportive environment", "learning environment",
          "code of conduct", "dress code", "new brunswick", "guest speaker", "guest speakers", "student center", "game plan",
          "role model", "role models", "business model", "keep track", "take pride", "state of the art", "liberal arts",
          "time management", "event planning", "raise money", "raising money", "draw attention", "raise awareness",
          "black history month", "data privacy", "the ultimate", "ultimate goal", "driving force", "pilot program",
          "discuss debate", "discuss and debate", "debate and socialize", "debate socialize"]
# Campus names that would otherwise read as topics ("Cook" is a campus, not cooking).
CAMPUS_PHRASES = re.compile(r"\b(cook|douglass|busch|livingston|college\s+ave(nue)?)(\s*/\s*douglass)?\s+(campus|student center|campuses)\b|\bcook\s*/\s*douglass\b|\bcook\s+douglass\b", re.I)
STOP = set(ENGLISH_STOP_WORDS) - {"back", "up", "out"}
NO_STEM = {"queer", "cooking", "founder", "founders", "rowing", "boxing", "care", "caring", "career", "careers", "maker", "makers", "news", "physics", "economics", "politics", "ethics", "athletics", "analytics", "genetics", "linguistics", "mathematics", "statistics", "robotics", "aeronautics", "classics"}


def stem(word):
    """A tiny suffix stripper, enough to make "games", "gaming" and "gamer" meet."""
    w = word.lower()
    if w in NO_STEM:
        return w
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        w = w[:-1]
    if w in NO_STEM:  # "cares" -> "care", and no further
        return w
    if len(w) > 5 and w.endswith("ing"):
        w = w[:-3]
    elif len(w) > 4 and w.endswith("er"):
        w = w[:-2]
    if len(w) > 3 and w.endswith("e"):
        w = w[:-1]
    return w


def words(text):
    return re.findall(r"[a-z0-9]+", text.lower().replace("’", "'").replace("'s", ""))


def stems(text):
    return [stem(w) for w in words(text)]


def _build_index():
    index = {}  # first stem -> [(phrase stems, {topic keys})]
    for key, (_, keywords, _) in TOPICS.items():
        for keyword in keywords:
            phrase = tuple(stems(keyword))
            if phrase:
                entries = index.setdefault(phrase[0], {})
                entries.setdefault(phrase, set()).add(key)
    for ignored in IGNORE:
        phrase = tuple(stems(ignored))
        index.setdefault(phrase[0], {}).setdefault(phrase, set())
    return {first: sorted(entries.items(), key=lambda e: -len(e[0])) for first, entries in index.items()}


PHRASES = _build_index()
VERSION = hashlib.sha256(json.dumps([TOPICS, SOFT, IGNORE, sorted(NO_STEM)], sort_keys=True).encode()).hexdigest()[:12]


def spans(text):
    """The text's words, and [(start, end, phrase, topic keys)] for each phrase found, longest first."""
    text_words = words(CAMPUS_PHRASES.sub(" ", text))
    tokens = [stem(w) for w in text_words]
    found, i = [], 0
    while i < len(tokens):
        for phrase, keys in PHRASES.get(tokens[i], ()):
            if tuple(tokens[i:i + len(phrase)]) == phrase:
                found.append((i, i + len(phrase), " ".join(phrase), keys))
                i += len(phrase)
                break
        else:
            i += 1
    return text_words, found


def match(text):
    """{topic key: [matched phrases]} for the topics this text mentions."""
    found = {}
    for _, _, phrase, keys in spans(text)[1]:
        for key in keys:
            found.setdefault(key, []).append(phrase)
    return found


def label(key):
    return TOPICS[key][0]


def broader(key):
    return TOPICS[key][2]


def weight(key):
    return SOFT.get(key, 1.0)
