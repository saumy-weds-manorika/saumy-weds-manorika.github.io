/**
 * Save the Train, Shaadi edition: every piece of content and configuration in one place.
 *
 * This is the family edition at /shaadi/: no guest list and no search. Guests pick which side
 * they are from, then add everyone on their ticket themselves (see
 * docs/superpowers/specs/2026-10-14-shaadi-edition-design.md).
 *
 * To go live (see docs/SETUP-shaadi.md):
 *   apiUrl   fill in the shaadi Apps Script web app URL ending in /exec
 *   siteUrl  the public address of this edition (already set)
 *
 * While apiUrl is empty the site runs in mock mode: answers are kept only in this browser,
 * and a ribbon says so.
 */
export const CONFIG = {
  edition: 'shaadi',
  couple: { a: 'Saumy', b: 'Manorika', joined: 'Saumy & Manorika', weds: 'Saumy weds Manorika' },
  city: 'Bhilwara', cityHi: 'भीलवाड़ा', station: 'BHL', state: 'Rajasthan',
  train: { name: 'Shaadi Express', number: '1011' },
  apiUrl: 'https://script.google.com/macros/s/AKfycbw9EB5HDk7qz2qq9Bj2Z7xT0ALslbdjH5DWOUIA07HpN0N9mdCxtnpZ5ifDS2I1hE4x/exec', // shaadi Apps Script /exec URL; '' => mock mode
  siteUrl: 'https://saumy-weds-manorika.github.io/shaadi/', // keep in step with the og: tags in index.html
  maxGuests: 6, // everyone on one ticket, the guest who fills it in included
  /**
   * "Which side are you from?" One tab per relation, in the order shown. side 'a' sits under Saumy
   * (blue), side 'b' under Manorika (pink). bond picks the leave-email wording (logic.leaveEmail).
   * The ids are what the Sheet stores; apps-script-shaadi/Code.gs has the same list.
   */
  sides: {
    a: { name: 'Saumy', role: 'दूल्हा', label: 'Ladke Wale side' },
    b: { name: 'Manorika', role: 'दुल्हन', label: 'Ladki Wale side' },
  },
  relations: [
    { id: 'ladke-wale', label: 'Ladke Wale', side: 'a', bond: 'family' },
    { id: 'mayra-ladke', label: 'Maayra (Ladke Wale)', side: 'a', bond: 'family' },
    { id: 'ladke-dost', label: 'Ladke Ke Dost', side: 'a', bond: 'friend' },
    { id: 'ladke-family-friends', label: 'Ladke Ke Family Friends', side: 'a', bond: 'family-friend' },
    { id: 'ladki-wale', label: 'Ladki Wale', side: 'b', bond: 'family' },
    { id: 'mayra-ladki', label: 'Maayra (Ladki Wale)', side: 'b', bond: 'family' },
    { id: 'ladki-sakhiyaan', label: 'Ladki Ki Sakhiyaan', side: 'b', bond: 'friend' },
    { id: 'ladki-family-friends', label: 'Ladki Ke Family Friends', side: 'b', bond: 'family-friend' },
  ],
  functions: [
    { id: 'carnival', name: 'Carnival', date: '2026-12-10', when: 'Afternoon', at: '2026-12-10T13:00' },
    { id: 'sangeet',  name: 'Sangeet',  date: '2026-12-10', when: 'Evening',   at: '2026-12-10T19:00' },
    { id: 'maayra',   name: 'Maayra',   date: '2026-12-11', when: 'Afternoon', at: '2026-12-11T13:00' },
    { id: 'baraat',   name: 'Baraat & Reception', date: '2026-12-11', when: 'Evening', at: '2026-12-11T18:00' },
    { id: 'phera',    name: 'Phera',    date: '2026-12-12', when: '3 AM. Yes, AM.', at: '2026-12-12T03:00' },
  ],
  arriveDates: ['2026-12-09', '2026-12-10', '2026-12-11', 'unsure'],
  departDates: ['2026-12-11', '2026-12-12', 'unsure'],
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
    // The first line names the side's own person ("Do you not love Saumy?" / "...Manorika?")
    dodges: { a: 'Do you not love Saumy?', b: 'Do you not love Manorika?' },
    more: ['How could you miss a Marwadi wedding?', 'You must be completely anti-fun person!!'],
    final: 'Okay, okay, you must be really busy at the time. We will try to understand. 😢',
  },
  cities: ['Ahmedabad','Ajmer','Bengaluru','Bhopal','Chandigarh','Chennai','Delhi','Gurugram','Hyderabad','Indore','Jaipur','Jodhpur','Kolkata','Kota','Lucknow','Mumbai','Noida','Pune','Surat','Udaipur','Vadodara'],
};
