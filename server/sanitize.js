const REPLACE_CHARS = [
  [/[\u2014\u2013\u2012\u2015]/g, '-'],
  [/[\u201C\u201D\u2018\u2019]/g, "'"],
  [/[\u2026]/g, '...'],
  [/[\u200B\u200C\u200D\uFEFF]/g, ''],
  [/[|]/g, '|']
];

const BANNED_PHRASES = [
  'as an ai', 'as an ai language model', 'as an llm', 'i am an ai', 'i am a language model',
  'lorem ipsum', 'as a language model', 'i cannot', 'i apologize', 'i apologise',
  'here is a', 'here are the', 'here is the', 'certainly', 'undoubtedly', 'in conclusion',
  'delve', 'delve into', 'elevate', 'seamless', 'seamlessly', 'in the realm of',
  'furthermore', 'moreover', 'additionally', 'additionally,', 'leverage', 'harness',
  'cutting-edge', 'state-of-the-art', 'revolutionize', 'game-changer', 'unlock',
  'empower', 'empowering', 'streamline', 'robust', 'seamless experience',
  'crafted', 'meticulously', 'comprehensive suite', 'versatile solution',
  'effortless', 'effortlessly', 'intuitive interface', 'user-friendly', 'user friendly',
  'a myriad of', 'plethora', 'encompasses', 'boasts', 'top-notch', 'world-class',
  'of course', 'no problem', 'sure thing', 'thanks for asking', 'great question',
  'to get started', 'let\'s dive in', 'lets dive in', 'so without further ado',
  'it\'s that simple', 'its that simple', 'the possibilities are endless',
  'whether you are a', 'whether you\'re a', 'regardless of', 'taking it to the next level',
  'kudos', 'good to know', 'happy to help', 'feel free to reach out'
];

const BANNED_RE = new RegExp(BANNED_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');

function sanitizeText(text) {
  let out = String(text);
  for (const [re, rep] of REPLACE_CHARS) out = out.replace(re, rep);
  out = out.replace(BANNED_RE, '');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/ +\n/g, '\n');
  out = out.replace(/\n{4,}/g, '\n\n\n');
  return out.trim();
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { sanitizeText, slugify };
