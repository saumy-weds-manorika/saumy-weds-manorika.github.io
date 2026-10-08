/**
 * Save the Train: every piece of content and configuration in one place.
 *
 * To go live, fill in three values (see docs/SETUP.md):
 *   apiUrl        the Google Apps Script web app URL ending in /exec
 *   hostWhatsApp  Saumy's WhatsApp number, digits only with country code
 *   siteUrl       the public address of this website once hosted
 *
 * While apiUrl is empty the site runs in mock mode: sample guests, and
 * answers are kept only in this browser.
 */
export const CONFIG = {
  couple: { a: 'Saumy', b: 'Manorika', joined: 'Saumy & Manorika', weds: 'Saumy weds Manorika' },
  city: 'Bhilwara', cityHi: 'भीलवाड़ा', station: 'BHL', state: 'Rajasthan',
  train: { name: 'Shaadi Express', number: '1012' },
  apiUrl: '',          // Apps Script /exec URL; '' => mock mode
  hostWhatsApp: '',    // Saumy's WhatsApp, digits only with country code, e.g. '919812345678'
  siteUrl: 'https://saumy-weds-manorika.github.io/', // GitHub Pages address of this repo; keep in step with the og: tags in index.html
  functions: [
    { id: 'carnival', name: 'Carnival', date: '2026-12-10', when: 'Afternoon', at: '2026-12-10T13:00' },
    { id: 'sangeet',  name: 'Sangeet',  date: '2026-12-10', when: 'Evening',   at: '2026-12-10T19:00' },
    { id: 'maayra',   name: 'Maayra',   date: '2026-12-11', when: 'Afternoon', at: '2026-12-11T13:00' },
    { id: 'baraat',   name: 'Baraat & Reception', date: '2026-12-11', when: 'Evening', at: '2026-12-11T18:00' },
    { id: 'phera',    name: 'Phera',    date: '2026-12-12', when: '3 AM. Yes, AM.', at: '2026-12-12T03:00' },
  ],
  arriveDates: ['2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', 'unsure'],
  departDates: ['2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14', 'unsure'],
  slots: [
    { id: 'early', label: 'Early morning', hint: 'before 8 AM' },
    { id: 'morning', label: 'Morning', hint: '8 AM – noon' },
    { id: 'afternoon', label: 'Afternoon', hint: 'noon – 4 PM' },
    { id: 'evening', label: 'Evening', hint: '4 – 8 PM' },
    { id: 'night', label: 'Night', hint: 'after 8 PM' },
    { id: 'unsure', label: 'Not sure yet', hint: '' },
  ],
  modes: [
    { id: 'train', label: 'Train' }, { id: 'flight', label: 'Flight' },
    { id: 'bus', label: 'Bus' }, { id: 'car', label: 'Car' },
  ],
  statuses: [
    { id: 'confirmed', label: 'Confirmed', stamp: 'CNF' },
    { id: 'waitlisted', label: 'Waitlisted', stamp: 'WL' },
    { id: 'regret', label: 'Regret', stamp: 'REGRET' },
  ],
  regret: {
    dodges: ['Do you not love Saumy?', 'How could you miss a Marwadi wedding?', 'You must be completely anti-fun person!!'],
    final: 'Okay, okay, you must be really busy at the time. We will try to understand. 😢',
  },
  cities: ['Ahmedabad','Ajmer','Bengaluru','Bhopal','Chandigarh','Chennai','Delhi','Gurugram','Hyderabad','Indore','Jaipur','Jodhpur','Kolkata','Kota','Lucknow','Mumbai','Noida','Pune','Surat','Udaipur','Vadodara'],
};
