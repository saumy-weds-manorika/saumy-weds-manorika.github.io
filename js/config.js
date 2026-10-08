/**
 * Save the Train: every piece of content and configuration in one place.
 *
 * To go live (see docs/SETUP.md):
 *   apiUrl        fill in the Google Apps Script web app URL ending in /exec
 *   hostWhatsApp  Saumy's WhatsApp number, digits only with country code (already set)
 *   siteUrl       the public address of this website once hosted (already set)
 *
 * While apiUrl is empty the site runs in mock mode: fictional sample guests, and
 * answers are kept only in this browser.
 */
export const CONFIG = {
  couple: { a: 'Saumy', b: 'Manorika', joined: 'Saumy & Manorika', weds: 'Saumy weds Manorika' },
  city: 'Bhilwara', cityHi: 'भीलवाड़ा', station: 'BHL', state: 'Rajasthan',
  train: { name: 'Shaadi Express', number: '1011' },
  apiUrl: 'https://script.google.com/macros/s/AKfycbyt2BKKaEqmeKVXoLSY1FBmw0g-DDQGhG2r91qJYL27YqdToyClS7T9ntgkk4qGdKnr/exec', // Apps Script /exec URL; '' => mock mode
  hostWhatsApp: '919414087162', // Saumy's WhatsApp, digits only with country code
  siteUrl: 'https://saumy-weds-manorika.github.io/', // GitHub Pages address of this repo; keep in step with the og: tags in index.html
  lists: ['Primary', 'Secondary'], // the two guest-list tabs ("First List", "Second List"); for display only
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
  // Route-stop chip order (v4 §O1): Bhilwara is home · Train · Bus · Car · Flight. The UI writes its own
  // chip copy (e.g. "Bhilwara is home"); these labels are the short names used on the pass and elsewhere.
  modes: [
    { id: 'local', label: 'Local' }, // "Bhilwara is home": no travel details needed
    { id: 'train', label: 'Train' }, { id: 'bus', label: 'Bus' },
    { id: 'car', label: 'Car' }, { id: 'flight', label: 'Flight' },
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
