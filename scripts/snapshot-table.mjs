// Saves the real Premier League table as a frozen snapshot for the next gameweek.
// Runs from GitHub Actions. Never overwrites an existing snapshot.
import fs from 'fs';

const KEY = process.env.FOOTBALL_DATA_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true';
const FORCE_TARGET = process.env.FORCE_TARGET ? Number(process.env.FORCE_TARGET) : null;
const MIN_GW = 6;            // GW2-5 stay on the proxy ranking, so nobody's points move
const SEASON = 2026;         // football-data.org uses the start year: 2026 = 2026/27
const FILE = 'snapshots.json';

// Must match the club names used in the app exactly.
const CLUBS = [
  'Arsenal','Manchester City','Manchester United','Aston Villa','Liverpool',
  'AFC Bournemouth','Sunderland','Brighton & Hove Albion','Brentford','Chelsea',
  'Fulham','Newcastle United','Everton','Leeds United','Crystal Palace',
  'Nottingham Forest','Tottenham Hotspur','Coventry City','Hull City','Ipswich Town'
];

if (!KEY) { console.error('Missing FOOTBALL_DATA_KEY'); process.exit(1); }

async function get(path) {
  const res = await fetch('https://api.football-data.org/v4' + path, { headers: { 'X-Auth-Token': KEY } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

const snaps = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};

// Which gameweek needs a snapshot right now? The one whose predecessor is fully
// finished (postponed matches don't block) and which has not kicked off yet.
let target = FORCE_TARGET;
if (!target) {
  const { matches } = await get(`/competitions/PL/matches?season=${SEASON}`);
  const byMd = {};
  matches.forEach(m => (byMd[m.matchday] ||= []).push(m));
  const DONE = ['FINISHED', 'POSTPONED', 'SUSPENDED', 'CANCELLED', 'AWARDED'];
  const STARTED = ['IN_PLAY', 'PAUSED', 'LIVE', 'FINISHED'];
  for (let n = 1; n < 38; n++) {
    const cur = byMd[n], nxt = byMd[n + 1];
    if (!cur || !nxt) continue;
    if (cur.every(m => DONE.includes(m.status)) && !nxt.some(m => STARTED.includes(m.status))) target = n + 1;
  }
}

if (!target || target < MIN_GW || snaps[target]) {
  console.log('Nothing to do. Target gameweek:', target, snaps[target] ? '(snapshot already exists)' : '');
  process.exit(0);
}

const standings = await get(`/competitions/PL/standings?season=${SEASON}`);
const total = standings.standings.find(s => s.type === 'TOTAL');
const order = total.table
  .sort((a, b) => a.position - b.position)
  .map(r => r.team.name.replace(/ (FC|AFC)$/, ''));

// Fail loudly rather than save a wrong table.
const bad = order.filter(n => !CLUBS.includes(n));
if (order.length !== 20 || new Set(order).size !== 20 || bad.length) {
  console.error('Table check failed. Unmatched names:', bad, 'Rows:', order.length);
  process.exit(1);
}

console.log(`Snapshot for GW${target}:`, order.join(', '));
if (DRY_RUN) { console.log('Dry run, nothing written.'); process.exit(0); }

snaps[target] = order;
const sorted = Object.fromEntries(Object.entries(snaps).sort((a, b) => Number(a[0]) - Number(b[0])));
fs.writeFileSync(FILE, JSON.stringify(sorted, null, 2) + '\n');
