/**
 * recurring-events.js
 * Medford's known recurring local events, keyed by day-of-week and season.
 * Exported for use by generate.js to inject into each edition.
 */

export const RECURRING = [
  // ── Music & Nightlife ───────────────────────────────────────────────────────
  {
    name: "Deep Cuts — Live Music",
    tag: "Music",
    type: "music",
    cadence: "Most nights",
    days: [3, 4, 5, 6],  // Wed–Sat
    desc: "Medford's 240-cap live music room, brewery, and record store. Check deepcutsmedford.com for tonight's show.",
    addr: "21 Main St, Medford",
    link: "https://deepcutsmedford.com",
  },
  {
    name: "Down By Riverside Blues Jam",
    tag: "Live Music",
    type: "music",
    cadence: "Recurring — check schedule",
    days: [0, 1, 2, 3, 4, 5, 6],
    desc: "The spiritual successor to the legendary Johnny D's blues jam, hosted at Arts Collaborative Medford.",
    addr: "162 Mystic Ave, Medford",
    link: "https://artscollabrativemedford.org",
  },

  // ── Food & Drink ────────────────────────────────────────────────────────────
  {
    name: "Great American Beer Hall — Trivia & Events",
    tag: "Food & Drink",
    type: "food",
    cadence: "Weekly — see calendar",
    days: [2, 3, 4],  // Wed–Fri
    desc: "Medford's big multipurpose hall runs trivia nights, DJs, and line dancing twice monthly. Always something on.",
    addr: "142 Mystic Ave, Medford",
    link: "https://greatamericanbeerhall.com",
  },
  {
    name: "Winter Farmers Market",
    tag: "Farmers Market",
    type: "food",
    cadence: "Tuesdays, January – April",
    days: [2],  // Tuesday
    seasonal: "winter",
    desc: "Weekly indoor farmers market hosted at Great American Beer Hall through the end of April.",
    addr: "142 Mystic Ave, Medford",
  },
  {
    name: "Medford Farmers Market",
    tag: "Farmers Market",
    type: "food",
    cadence: "Summer outdoor markets",
    days: [0, 2, 6],
    seasonal: "summer",
    desc: "Outdoor seasonal market with local produce, prepared food, and artisan vendors.",
    addr: "Medford Square area",
  },
  {
    name: "Twisted Tree Cafe",
    tag: "Coffee & Café",
    type: "food",
    cadence: "Daily",
    days: [0, 1, 2, 3, 4, 5, 6],
    desc: "Coffee, tea, toasts, bowls, and salads in West Medford. Gluten-free, vegan, and dairy-free options available.",
    addr: "421 High St, West Medford",
    link: "https://thetwistedtreecafe.com",
  },

  // ── Arts & Culture ──────────────────────────────────────────────────────────
  {
    name: "Medford Public Library Programs",
    tag: "Library",
    type: "arts",
    cadence: "Daily — 1,000+ events/year",
    days: [1, 2, 3, 4, 5, 6],
    desc: "Book clubs, cooking classes, live music, dance workshops, STEM for kids, and more. The city's most active community hub.",
    addr: "111 High St, Medford",
    link: "https://medfordlibrary.org",
  },
  {
    name: "Condon Shell Summer Concerts",
    tag: "Free Concert",
    type: "arts",
    cadence: "Summer evenings",
    seasonal: "summer",
    days: [3, 4, 5],
    desc: "Free outdoor concerts at the riverside Condon Shell amphitheater. Bring a blanket.",
    addr: "Riverside Ave, Medford",
  },
  {
    name: "Moon and Back Bookstore Events",
    tag: "Bookstore",
    type: "arts",
    cadence: "Weekly storytime + events",
    days: [2, 4, 6],
    desc: "Independent bookstore with regular storytime for kids, author events, and community readings.",
    addr: "458 High St, Medford",
  },

  // ── Outdoors ────────────────────────────────────────────────────────────────
  {
    name: "Middlesex Fells Nature Walks",
    tag: "Outdoors",
    type: "nature",
    cadence: "Year-round, city-organized",
    days: [0, 6],  // Weekends
    desc: "City and DCR-organized guided walks through the Fells reservation — wildflowers, birds, invasive plant removal, and more.",
    addr: "Middlesex Fells Reservation, Medford",
    link: "https://medfordma.org",
  },
  {
    name: "Clippership Connector Path",
    tag: "Outdoors",
    type: "nature",
    cadence: "Open daily",
    days: [0, 1, 2, 3, 4, 5, 6],
    desc: "Paved riverside path connecting Medford to the Mystic River Greenway. Popular for running, walking, and cycling.",
    addr: "Riverside Ave, Medford",
  },
];

/**
 * Returns 3–4 events relevant to a given day-of-week (0=Sun … 6=Sat)
 * and current month, mixing types for variety.
 */
export function getEventsForDay(dowIndex, month) {
  const isSummer = month >= 5 && month <= 8;   // Jun–Sep
  const isWinter = month <= 3 || month >= 11;  // Jan–Apr, Nov–Dec

  const eligible = RECURRING.filter(e => {
    if (!e.days.includes(dowIndex)) return false;
    if (e.seasonal === "summer" && !isSummer) return false;
    if (e.seasonal === "winter" && !isWinter) return false;
    return true;
  });

  // Shuffle and pick a variety of types
  const picked = [];
  const types = ["music", "food", "arts", "nature"];
  for (const type of types) {
    const match = eligible.find(e => e.type === type && !picked.includes(e));
    if (match) picked.push(match);
    if (picked.length >= 4) break;
  }
  // Fill remaining slots if needed
  for (const e of eligible) {
    if (picked.length >= 4) break;
    if (!picked.includes(e)) picked.push(e);
  }

  return picked.slice(0, 4);
}
