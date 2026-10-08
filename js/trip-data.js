// Rajasthan long-weekend escapes (spec v3 §M). Road distances and typical car times from
// Bhilwara were cross-checked with two open route planners and several cab sites; every
// number and fact is sourced in docs/trip-research.md. Notes stay at 250 characters or fewer.
//
// label: the preferred name-label position, in map units (the map is 340 units wide, about
// 1 unit per CSS px on a phone): dx/dy from the pin centre to the text baseline point, and
// the SVG text-anchor. trip.js falls back to other spots if this one would collide.

export const ORIGIN = { name: 'Bhilwara', lat: 25.35, lon: 74.63 };

export const DESTINATIONS = [
  {
    id: 'chittaurgarh',
    name: 'Chittaurgarh',
    lat: 24.8864,
    lon: 74.6469,
    km: 60,
    drive: '~1h',
    note: "Just an hour down the highway: one of India's largest forts, a UNESCO site steeped in Rajput legend. Admire the 37 m Vijaya Stambha (Tower of Victory), find Padmini's Palace and the Meera temple, and ask about the evening sound-and-light show.",
    label: { dx: 11, dy: 4.5, anchor: 'start' },
  },
  {
    id: 'nathdwara',
    name: 'Nathdwara',
    lat: 24.93,
    lon: 73.82,
    km: 110,
    drive: '~1h 45m',
    note: 'Home of the Shrinathji temple (1672), where Krishna is worshipped as a seven-year-old child. Look up at the 369 ft Statue of Belief, the world\'s tallest Shiva statue, and browse hand-painted Pichwai art. An easy add-on to Udaipur.',
    label: { dx: -11, dy: 4.5, anchor: 'end' },
  },
  {
    id: 'udaipur',
    name: 'Udaipur',
    lat: 24.58,
    lon: 73.68,
    km: 150,
    drive: '~2h 45m',
    note: 'The City of Lakes, founded by Maharana Udai Singh II. Watch the sun set over Lake Pichola and the island Lake Palace, wander the City Palace (built over nearly 400 years), then stay for the evening Dharohar folk-dance show.',
    label: { dx: 11, dy: 4.5, anchor: 'start' },
  },
  {
    id: 'pushkar',
    name: 'Pushkar',
    lat: 26.4878,
    lon: 74.5558,
    km: 150,
    drive: '~2h 45m',
    note: "A holy lake town of 52 ghats and one of India's very few Brahma temples. Ride the ropeway up to the hilltop Savitri temple for the view, then lose an afternoon in the bazaar. Vegetarian, alcohol-free and blissfully slow.",
    label: { dx: 11, dy: 4.5, anchor: 'start' },
  },
  {
    id: 'kumbhalgarh',
    name: 'Kumbhalgarh',
    lat: 25.1489,
    lon: 73.5803,
    km: 155,
    drive: '~3h',
    note: "Rana Kumbha's 15th-century hill fort, a UNESCO site and the birthplace of Maharana Pratap. Its ~36 km wall is often called the world's second-longest. More than 360 temples hide inside; stay for the evening light-and-sound show.",
    label: { dx: 4, dy: -12, anchor: 'middle' },
  },
  {
    id: 'ranakpur',
    name: 'Ranakpur',
    lat: 25.1157,
    lon: 73.4728,
    km: 175,
    drive: '~3h 15m',
    note: 'A 15th-century marble Jain temple to Adinath, held up by 1,444 carved pillars, no two alike. Non-Jain visitors usually get in from noon; cover shoulders and legs, and leave leather at the gate. Pairs beautifully with Kumbhalgarh.',
    label: { dx: -11, dy: 6, anchor: 'end' },
  },
  {
    id: 'jaipur',
    name: 'Jaipur',
    lat: 26.915,
    lon: 75.82,
    km: 250,
    drive: '~4h',
    note: "The Pink City, painted pink to welcome a visiting prince in 1876. Count Hawa Mahal's 953 windows, stand beside the world's largest stone sundial at Jantar Mantar and head up to Amer Fort. Bazaar time is non-negotiable.",
    label: { dx: -11, dy: 4.5, anchor: 'end' },
  },
  {
    id: 'mount-abu',
    name: 'Mount Abu',
    lat: 24.5925,
    lon: 72.7083,
    km: 290,
    drive: '~5h 15m',
    note: "Rajasthan's only hill station (now also called Abu Raj), 1,220 m up in the Aravallis. See the marble Dilwara temples, row on Nakki Lake and drive up to Guru Shikhar (1,722 m). Pack a jacket: December nights dip to about 4°C.",
    label: { dx: -5, dy: -12, anchor: 'start' },
  },
];

// Section copy for the junction stop and the departure-stop teaser (§M). No dates here: the
// wedding is Thursday and Friday, and the trip is "the weekend that follows".
export const TRIP_COPY = {
  title: 'Make a royal vacay of it',
  intro: 'Once the baraat has danced its last, Rajasthan\'s palaces, lakes and forts are only a drive away. If you\'d like to stretch your trip into the weekend, here are our favourite getaways near Bhilwara. Tap a pin to plan your escape.',
  teaser: "Fancy turning the trip into a royal Rajasthani getaway? We've picked a few weekend escapes near Bhilwara for you. They're waiting at the end of your journey.",
};
