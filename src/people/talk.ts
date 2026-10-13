// What the people in the marinas say. Pure: a persona (name, role, age) and the situation (where
// you are, the weather, other marinas around, facts from the marina's Wikipedia article, your boat,
// whether you look hungry) go in, a conversation comes out — a greeting, three topics, a goodbye.
// Stories are put together from pieces, so they are different every time.

export type Role = 'fisherman' | 'skipper' | 'tourist' | 'kid' | 'artist' | 'harbourhand' | 'birdwatcher' | 'baker';

export interface Persona {
  name: string;
  role: Role;
  age: 'kid' | 'adult' | 'old';
  female: boolean;
}

export interface TalkContext {
  /** this marina, as people say it ("Brouwershaven") */
  place: string;
  /** other marinas around, nearest first */
  others: Array<{ name: string; km: number; direction: string }>;
  wind: { direction: string; force: number };
  rain: number;
  fog: number;
  /** sentences from the marina's Wikipedia article (may be empty) */
  facts: string[];
  /** the player's boat is in sight (moored or nearby) */
  boatNear: boolean;
  hungry: boolean;
  thirsty: boolean;
}

const WOMEN = ['Anneke', 'Femke', 'Marieke', 'Sanne', 'Lotte', 'Ingrid', 'Els', 'Joke', 'Saskia', 'Mirjam', 'Ria', 'Fenna', 'Noor', 'Tess'];
const MEN = ['Jan', 'Pieter', 'Kees', 'Willem', 'Joost', 'Bram', 'Henk', 'Dirk', 'Gerrit', 'Maarten', 'Sjoerd', 'Teun', 'Ruud', 'Daan'];
const KIDS = ['Sem', 'Lieke', 'Finn', 'Julia', 'Luuk', 'Mila', 'Jesse', 'Saar'];
const ROLES: Role[] = ['fisherman', 'skipper', 'tourist', 'artist', 'harbourhand', 'birdwatcher', 'baker'];

export function makePersona(rng: () => number): Persona {
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  if (rng() < 0.12) {
    const female = rng() < 0.5;
    return { name: pick(KIDS), role: 'kid', age: 'kid', female };
  }
  const female = rng() < 0.5;
  const role = pick(ROLES);
  const age = role === 'skipper' || rng() < 0.3 ? 'old' : 'adult';
  return { name: pick(female ? WOMEN : MEN), role, age, female };
}

/** "Jachthaven Scharendijke" → "Scharendijke": the place, not the club. */
export function placeName(name: string): string {
  const cleaned = name
    .replace(/^(WV|WSV|ZV|YC|KZV|VVW|W\.?S\.?V\.?)\s+/i, '')
    .replace(/\b(jachthaven(\/-werf)?|watersportvereniging|tijhaven|haven|marina|jachtclub|yacht ?club|passantenhaven|gemeentehaven)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 3 ? cleaned : name.trim();
}

/** Sentences from an article worth saying aloud: not too short or long, no brackets or lists. */
export function factSentences(text: string | undefined): string[] {
  if (!text) return [];
  return (text.replace(/\s*\([^)]*\)/g, '').match(/[^.!?]+[.!?]/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 220 && !/[;:[\]{}|=]/.test(s) && /^[A-Z]/.test(s));
}

type Topic = 'weather' | 'tip' | 'fact' | 'story' | 'advice' | 'you' | 'role';

/**
 * A whole conversation: greeting, three topics (no topic twice; a fact first if the marina has an
 * article), goodbye. Each entry is one line to speak.
 */
export function conversation(p: Persona, c: TalkContext, rng: () => number): string[] {
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  const lines = [greeting(p, c, pick)];
  const topics: Topic[] = ['weather', 'story', 'advice', 'role'];
  if (c.others.length) topics.push('tip', 'tip');
  if (c.boatNear || c.hungry || c.thirsty) topics.push('you', 'you');
  // Shuffle; facts (when there are any) and stories are the best bits.
  for (let i = topics.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [topics[i], topics[j]] = [topics[j], topics[i]];
  }
  const chosen: Topic[] = c.facts.length ? ['fact'] : [];
  for (const t of topics) if (chosen.length < 3 && !chosen.includes(t)) chosen.push(t);
  if (!chosen.includes('story') && rng() < 0.6) chosen[chosen.length - 1] = 'story';
  for (const t of chosen) lines.push(topic(t, p, c, rng, pick));
  lines.push(goodbye(p, c, pick));
  return lines;
}

type Pick = <T>(list: T[]) => T;

function greeting(p: Persona, c: TalkContext, pick: Pick): string {
  if (p.role === 'kid') {
    return pick([
      `Hi! I'm ${p.name}. Is that a real sailing boat? Can I come aboard? Just kidding.`,
      `Hello! My name is ${p.name} and I'm eight and a half. Are you a pirate?`,
      `Hi! I'm ${p.name}. My mum says I shouldn't talk to strangers, but you look nice.`,
    ]);
  }
  return pick([
    `Hello! Nice to meet you. I'm ${p.name}.`,
    `Goedemiddag! Oh, you speak English? Welcome to ${c.place}! I'm ${p.name}.`,
    `Ahoy there, sailor! ${p.name}, pleased to meet you.`,
    `Well hello! You're not from around here, are you? I'm ${p.name}. Welcome to ${c.place}.`,
    `Hi! Lovely to see a new face in ${c.place}. I'm ${p.name}.`,
  ]);
}

function goodbye(p: Persona, c: TalkContext, pick: Pick): string {
  if (p.role === 'kid') return pick(['I have to go, my mum is calling. Bye!', 'Bye! Watch out for the jellyfish!', 'Okay bye! If you see a seal, say hi from me!']);
  return pick([
    'Well, I must be going. Fair winds!',
    `It was nice talking to you. Enjoy ${c.place}!`,
    'Anyway, I have things to do. Goede vaart, as we say: have a good trip!',
    'Right, the coffee is getting cold. Take care out there!',
    `Have a lovely time. And always keep one hand for the boat!`,
  ]);
}

function topic(t: Topic, p: Persona, c: TalkContext, rng: () => number, pick: Pick): string {
  switch (t) {
    case 'weather':
      return weather(c, pick);
    case 'tip': {
      const o = c.others[Math.min(c.others.length - 1, Math.floor(rng() * Math.min(3, c.others.length)))];
      const km = o.km < 1.5 ? 'just round the corner' : `only ${Math.round(o.km)} kilometres to the ${o.direction}`;
      return pick([
        `Hey, you need to visit ${o.name}! It's ${km}. Lovely little harbour.`,
        `Have you been to ${o.name} yet? ${km.charAt(0).toUpperCase() + km.slice(1)}. The best fish and chips on the coast, they say.`,
        `If you sail on, try ${o.name}, ${km}. My cousin lives there. Say hello from ${p.name}!`,
        `Don't miss ${o.name}. It's ${km}, and the sunsets there are something else.`,
      ]);
    }
    case 'fact': {
      const f = pick(c.facts);
      return pick([`Did you know? ${f}`, `Here's something not many visitors know. ${f}`, `My teacher used to tell us this: ${f}`, `A bit of history for you. ${f}`]);
    }
    case 'story':
      return story(p, c, rng, pick);
    case 'advice':
      return pick([
        `If you need food, the supermarket by the pier has everything. The water is only seventy-nine cents.`,
        `Diesel is one ninety-five a litre at the pier head. Robbery, if you ask me. Sail, it's free!`,
        `Watch out for the big ships out there. They can't stop, and they can't see you.`,
        `Always check the weather before you go out. The North Sea doesn't forgive mistakes.`,
        `The marina office has photos of the old days. Go and have a look, it's free.`,
        `Keep your radio on channel sixteen. The coast guard reads the weather there.`,
      ]);
    case 'you':
      if (c.hungry && (c.thirsty ? rng() < 0.5 : true)) {
        return pick([`You look hungry, if you don't mind me saying. The rolls in the supermarket are excellent.`, `Have you eaten today? You look a bit pale. Get yourself some bread and a banana.`]);
      }
      if (c.thirsty) return pick([`You look thirsty. Get some water before you sail on, it's important out there.`, `Drink something! Sailors always forget to drink, and then they get headaches.`]);
      return pick([`Is that your yacht over there? She's a beauty!`, `Nice boat you have. Twelve metres? I always wanted one like that.`, `I saw you come in. Nicely done, you didn't hit a single pontoon!`]);
    case 'role':
      return role(p, c, pick);
  }
}

function weather(c: TalkContext, pick: Pick): string {
  const { direction, force } = c.wind;
  if (c.fog > 0.4) return pick([`This fog! You can't see the end of the pier. Stay in port if you can.`, `Have you heard the foghorn? No? Neither have I, they took it away years ago. Careful in this fog.`]);
  if (c.rain > 0.4) return pick([`Terrible rain, isn't it? Good for the tulips, though.`, `Rain again. They say it rains here only twice a year: once from August to March, and once from April to July.`]);
  if (force >= 6) return pick([`Have you heard the forecast? Force ${force} from the ${direction}. I wouldn't go out today.`, `Strong wind today, force ${force}. Double your mooring lines, my friend.`]);
  if (force <= 2) return pick([`Hardly any wind today. A good day for the motor, or for an ice cream.`, `So calm! You could row to ${c.others[0]?.name ?? 'the next harbour'} today.`]);
  return pick([
    `You already heard about the weather? Wind ${direction}, force ${force}. Perfect sailing.`,
    `Lovely breeze today, force ${force} from the ${direction}. If I were you, I'd be out there.`,
    `The wind is ${direction} today. My knee always knows before the radio does.`,
  ]);
}

function role(p: Persona, c: TalkContext, pick: Pick): string {
  switch (p.role) {
    case 'fisherman':
      return pick([`I've been fishing here for forty years. The fish get smaller, the stories get bigger.`, `Mussels, that's what this coast is famous for. The best ones grow right out there.`]);
    case 'skipper':
      return pick([`I sailed to Norway and back in a boat smaller than yours. In nineteen seventy-eight, that was.`, `Forty years at sea, and I still get seasick on the first day. Every time.`]);
    case 'tourist':
      return pick([`We're here on holiday. We rented bicycles, but my husband keeps falling off.`, `It's our first time in Zeeland. Everything is so flat! Except the waves.`]);
    case 'artist':
      return pick([`I paint the harbour every morning. The light here is like nowhere else.`, `One of my paintings hangs in the marina office. The seascape with the little boat. That's mine!`]);
    case 'harbourhand':
      return pick([`I look after the pontoons here. If anything breaks, you call me. Or better, don't break anything.`, `Busy day. Three boats came in at once this morning, and all of them wanted the same berth.`]);
    case 'birdwatcher':
      return pick([`I saw an avocet this morning! And two spoonbills. Best day of the year.`, `The gulls here are clever. One stole my sandwich right out of my hand yesterday.`]);
    case 'baker':
      return pick([`I bake the bread for the supermarket every morning at four. Try the rolls, they're mine.`, `People come from ${c.others[0]?.name ?? 'all over'} for my apple pie. Just saying.`]);
    case 'kid':
      return pick([`I caught a crab yesterday. It was this big! Well, a bit smaller.`, `Do you know how to tie a bowline? My grandpa showed me. The rabbit comes out of the hole…`]);
  }
}

/** A little story put together from pieces. */
function story(p: Persona, c: TalkContext, rng: () => number, pick: Pick): string {
  const other = c.others.length ? pick(c.others).name : 'the next harbour';
  const relative = pick(p.role === 'kid' ? ['My grandpa', 'My big sister', 'My teacher'] : ['My grandfather', 'My old uncle', 'A friend of mine', 'My neighbour', 'The harbour master']);
  const seal = pick(['Bolle', 'Sjaak', 'Truus', 'Kees', 'Dikkie']);
  const year = 1950 + Math.floor(rng() * 60);
  return pick([
    `${relative} was a fisherman here. One winter in ${year} the harbour froze so hard he walked across the ice to ${other} to buy bread.`,
    `Last summer a seal called ${seal} slept on the pier for three weeks. Everyone brought him herring. He got very fat.`,
    `In ${year} a storm blew a whole boat onto the dyke. It stood there for a month, and people came from ${other} just to look at it.`,
    `I once lost my hat off ${c.place} in a force ${Math.max(5, c.wind.force + 2)} gust. A week later a fisherman found it in ${other}. Still had my sandwich in it.`,
    `${relative} swears there is a sunken ship full of cheese just outside the harbour. Nobody has ever found it. Or maybe someone ate it.`,
    `When I was little, a whale swam into the harbour. A real one! The whole village stood on the quay and cheered when it found its way out again.`,
    `They say the old lighthouse keeper of ${c.place} still walks the pier on foggy nights. I've never seen him. But I don't go out on foggy nights either.`,
    `${relative} once raced the ferry to ${other} in a little rowing boat. He lost, of course. But only by an hour.`,
  ]);
}
