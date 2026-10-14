// Getting to Bhilwara: verified on 2026-10-08 (see docs/travel-research.md for sources and method).
// Road distances are to Bhilwara railway station, rounded to the nearest 5 km; drive times are
// conservative car estimates. Lists are sorted nearest-first.

export const BHILWARA_STATION = { code: 'BHL', name: 'Bhilwara' };

export const AIRPORTS = [
  { code: 'UDR', name: 'Udaipur', city: 'Udaipur', km: 145, drive: '~2h 30m' },
  { code: 'KQH', name: 'Kishangarh', city: 'Kishangarh (Ajmer)', km: 160, drive: '~2h 30m' },
  { code: 'JAI', name: 'Jaipur', city: 'Jaipur', km: 255, drive: '~4h' },
  { code: 'AMD', name: 'Ahmedabad', city: 'Ahmedabad', km: 410, drive: '~7h' },
];

export const JUNCTIONS = [
  { code: 'COR', name: 'Chittaurgarh', km: 55, drive: '~1h' },
  { code: 'AII', name: 'Ajmer', km: 135, drive: '~2h 15m' },
  { code: 'UDZ', name: 'Udaipur City', km: 155, drive: '~2h 45m' },
  { code: 'KOTA', name: 'Kota', km: 160, drive: '~3h' },
  { code: 'JP', name: 'Jaipur', km: 250, drive: '~4h' },
  { code: 'RTM', name: 'Ratlam', km: 265, drive: '~5h' },
];

export const HIGHWAYS = [
  'Bhilwara sits just off NH48, the Delhi–Jaipur–Ajmer–Chittaurgarh–Udaipur–Ahmedabad highway.',
  'NH758 runs right through town, linking Bhilwara with Rajsamand and Udaipur, and with Kota via NH27.',
];

export const BUS_FACTS = [
  'Rajasthan Roadways (RSRTC) and private buses run to Bhilwara from Jaipur (~5–6.5h), Udaipur (~3–3.5h) and Kota (~4h).',
  'Overnight AC sleepers come in from Delhi (~8–10h), Ahmedabad (~8–9h) and Indore (~6.5–8.5h).',
];
