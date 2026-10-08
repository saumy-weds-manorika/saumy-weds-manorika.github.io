# Rajasthan long-weekend map: research notes

These are the numbers and facts behind `js/trip-data.js`, the data for the junction-stop map (spec v3 §M). Everything below was checked against at least two independent sources. Anything the sources disagreed on is either softened in the copy or left out.

## How the numbers were checked

- **Road distance** is from Bhilwara (25.35, 74.63) to the destination (for Chittaurgarh, to the fort). Every route was planned with two open-source routers: [Valhalla](https://valhalla1.openstreetmap.de) (FOSSGIS) and [OSRM](https://router.project-osrm.org). Their full route lines were read to confirm which towns each route passes through. The result was then compared with cab and route-planner sites. The final figure is rounded to the nearest 5 km.
- **Drive time** is a typical car time, not a free-flow router time. Routers assume empty roads (OSRM gives 1h50m for Pushkar, for example), so the figure leans on cab-site quotes and allows for two-lane stretches, ghats and city traffic. It is rounded to 15 minutes and always shown with "~".
- **Coordinates** are from Wikipedia's API and match each place's article.
- **Map display:** Kumbhalgarh and Ranakpur are only about 12 km apart, so the map nudges their pins about 2.5 km apart at phone scale so both stay tappable. The data keeps the true coordinates.

## Final numbers

Listed nearest first, as on the map's chips.

| Destination | Road | By car | Usual route | Lat, lon | Confidence |
|---|---|---|---|---|---|
| Chittaurgarh | 60 km | ~1h | NH48 south, then up to the hilltop fort (town centre about 54 to 57 km) | 24.8864, 74.6469 | high |
| Nathdwara | 110 km | ~1h 45m | NH758 via Gangapur to Rajsamand, then NH58 south | 24.93, 73.82 | high |
| Udaipur | 150 km | ~2h 45m | NH758 via Gangapur to Rajsamand, then NH58 past Nathdwara (NH48 via Chittorgarh is longer, about 170 km) | 24.58, 73.68 | high |
| Pushkar | 150 km | ~2h 45m | NH48 north to Nasirabad, NH448 to Ajmer, then NH58 and Pushkar Road over the ghat | 26.4878, 74.5558 | high |
| Kumbhalgarh | 155 km | ~3h | NH758 to Rajsamand, then hill roads to Kelwara and SH49 up to the fort (147 km direct, 162 km via Nathdwara and NH162) | 25.1489, 73.5803 | medium |
| Ranakpur | 175 km | ~3h 15m | NH758 to Rajsamand (Kankroli), then west via Charbhuja, Desuri (NH162) and Sadri | 25.1157, 73.4728 | medium |
| Jaipur | 250 km | ~4h | NH48 north via Gulabpura, Nasirabad and Kishangarh, into Jaipur on Ajmer Road | 26.915, 75.82 | high |
| Mount Abu | 290 km | ~5h 15m | NH758 to Rajsamand, NH58 to the Udaipur bypass, NH27 via Gogunda and Pindwara to Abu Road, then the hill road | 24.5925, 72.7083 | medium |

Origin: **Bhilwara**, 25.35, 74.63 (confirmed).

### Distance and time evidence

| Destination | Valhalla | OSRM | Other sources |
|---|---|---|---|
| Chittaurgarh | 61.1 km to the fort, 56.9 km to the town | 58.8 km to the fort (free-flow 55 min) | Rome2rio 53.9 km to the town; EaseMyTrip ~58 km |
| Nathdwara | 109.0 to 109.8 km | 109.7 km (free-flow 1h24m) | EaseMyTrip 109 km, 1h49m; distancebetween2 103.7 km; MakeMyTrip cab ~2h |
| Udaipur | 153.6 to 155.7 km | 155.4 km; 170.4 km via NH48 | Cleartrip ~152 km, ~2h14m; CabBazar 152 km, 2.7 h; oneway.cab ~152 km, 2h39m |
| Pushkar | 148.8 to 149.7 km | 148.2 km (free-flow 1h50m) | MakeMyTrip ~150 km, ~3h; redBus ~150 km |
| Kumbhalgarh | 162.0 km | 161.7 km; ~147 km direct via Kelwara | Rome2rio ~141 km; Flamingo Travels 157 km; MakeMyTrip cab ~3h |
| Ranakpur | 176.1 km | 173.8 km (free-flow 2h17m) | distancebetween2 175.8 km; MakeMyTrip cab ~3h05m |
| Jaipur | 251.5 km | 250.0 km (free-flow 3h09m) | Cleartrip ~249 km, ~3h35m; distancebetween2 253 km; MakeMyTrip ~250+ km |
| Mount Abu | 298.5 km (321 km via Chittorgarh) | 298.0 km (free-flow 3h51m) | CabBazar 282 km, 5.4 h; EaseMyTrip 283 km, 4h43m; distancebetween2 292.7 km |

Corrections made during the fact-check:
- **Udaipur:** drive time raised from ~2h30m to ~2h45m. Cab sites quote 2h39m to 2.7 h, and NH758 has a two-lane stretch.
- **Mount Abu:** changed from 285 to 290 km and from ~5h to ~5h 15m. The routers say 298 km and Google-based cab sites say 282 to 283 km; 290 is the midpoint.
- **Kumbhalgarh:** changed from 150 to 155 km, the midpoint of the 147 to 162 km range.
- **Jaipur:** drive time changed from ~3h 45m to ~4h, to match the Jaipur Junction and airport figures in `docs/travel-research.md` (same road, ~250 km; MakeMyTrip's cab FAQ says about 4h 13m). A guest who sees both lines now sees one number.
- **Ranakpur:** changed from 170 to 175 km.
- **Nathdwara:** changed from 105 to 110 km. Its coordinates were updated to Wikipedia's town figure (the old point was within 0.5 km).

## Facts used in the notes

Each note in `trip-data.js` is 120 to 250 characters (`tests/trip.test.mjs` enforces 60 to 250). Only the facts below are used.

- **Chittaurgarh:** one of India's largest forts (280 ha) and part of UNESCO's "Hill Forts of Rajasthan" (2013). The 37.2 m Vijaya Stambha (Tower of Victory) was built in 1458–68. The fort also holds Padmini's Palace and the Meera temple. The sound-and-light show is softened to "ask about the evening sound-and-light show", because Incredible India lists it daily from 7 to 8 pm but an undated listing says it is suspended.
- **Nathdwara:** the Shrinathji temple dates from 1672. The deity is Krishna as a seven-year-old child lifting Govardhan hill, not an infant. The 369 ft Statue of Belief (opened 29 Oct 2022) is the world's tallest Shiva statue. The town is known for Pichwai paintings and is 48 km north-east of Udaipur.
- **Udaipur:** founded by Maharana Udai Singh II and known as the City of Lakes. The founding year (1559, or 1553 by some accounts) is left out. The City Palace was built over nearly 400 years. The Lake Palace stands on an island in Lake Pichola. The Dharohar folk-dance show at Bagore ki Haveli is called an "evening show" because its times vary.
- **Pushkar:** 52 ghats and one of India's very few Brahma temples. A ropeway climbs to the hilltop Savitri Mata temple. The sale of meat, eggs and alcohol is banned in the town.
- **Kumbhalgarh:** a 15th-century fort built by Rana Kumbha, a UNESCO hill fort, and the birthplace of Maharana Pratap. Its wall is about 36 km long; the note says it is "often called" the world's second-longest, because that ranking isn't in Wikipedia. More than 360 temples stand inside. The note mentions the evening light-and-sound show without times.
- **Ranakpur:** a 15th-century marble Jain temple to Adinath (the sources give conflicting exact dates). It has 1,444 pillars and no two are alike. Non-Jain visitors are usually admitted from about noon to 5 pm. Visitors cover their legs and shoulders and leave leather at the entrance.
- **Jaipur:** painted pink to welcome the Prince of Wales in 1876. Hawa Mahal has 953 windows. Jantar Mantar has the world's largest stone sundial (27 m). Amer Fort is a UNESCO hill fort.
- **Mount Abu:** Rajasthan's only hill station, at 1,220 m. In February 2026 the Chief Minister announced it would be renamed **Abu Raj**, but no gazette notification was found, so the copy says "now also called Abu Raj" and keeps "Mount Abu" for display and the Google Maps link. The note also uses the marble Dilwara temples, Nakki Lake and Guru Shikhar (1,722 m, the highest point of the Aravallis). December's average low is 3.8 °C, so the note says "pack a jacket".

Deliberately left out:
- the Pushkar camel fair (2026 runs about 17–25 Nov, over before the wedding);
- Jag Mandir's construction dates (Wikipedia contradicts itself);
- every opening time (sources disagree);
- Ranakpur's camera fee (not re-verified).

## Copy and calendar

The wedding is on Thursday 10 and Friday 11 December 2026, so the weekend that follows is free. The copy never prints that weekend's dates; it says "the weekend that follows" (spec §J and §M).

## Sources

- Routing: [Valhalla (FOSSGIS)](https://valhalla1.openstreetmap.de), [OSRM](https://router.project-osrm.org)
- Route and cab sites:
  - Cleartrip: [Bhilwara–Udaipur](https://www.cleartrip.com/tourism/routes/dd/bhilwara-to-udaipur-route.html), [Bhilwara–Jaipur](https://www.cleartrip.com/tourism/routes/dd/bhilwara-to-jaipur-route.html)
  - CabBazar: [Udaipur](https://cabbazar.com/taxi/cab/bhilwara-to-udaipur), [Mount Abu](https://cabbazar.com/taxi/cab/bhilwara-to-mount-abu)
  - [oneway.cab: Udaipur](https://oneway.cab/udaipur/udaipur-to-bhilwara-taxi)
  - EaseMyTrip: [Mount Abu](https://www.easemytrip.com/cabs/bhilwara-to-mount-abu-cab-booking/), [Chittorgarh](https://www.easemytrip.com/cabs/bhilwara-to-chittorgarh-cab-booking/), [Nathdwara](https://www.easemytrip.com/cabs/nathdwara-to-bhilwara-cab-booking/)
  - MakeMyTrip route planner: [Jaipur](https://www.makemytrip.com/routeplanner/bhilwara-jaipur.html), [Pushkar](https://www.makemytrip.com/routeplanner/bhilwara-pushkar.html), [Kumbhalgarh](https://www.makemytrip.com/routeplanner/bhilwara-kumbhalgarh.html), [Ranakpur](https://www.makemytrip.com/routeplanner/bhilwara-ranakpur.html), [Nathdwara](https://www.makemytrip.com/routeplanner/bhilwara-nathdwara.html)
  - distancebetween2: [Jaipur](https://distancebetween2.com/bhilwara/jaipur), [Mount Abu](https://distancebetween2.com/bhilwara/mount_abu), [Ranakpur](https://distancebetween2.com/bhilwara/ranakpur), [Nathdwara](https://distancebetween2.com/bhilwara/nathdwara)
  - Rome2rio: [Kumbhalgarh](https://www.rome2rio.com/s/Bhilwara/Kumbhalgarh), [Chittorgarh](https://www.rome2rio.com/s/Bhilwara/Chittorgarh)
  - [redBus: Pushkar](https://www.redbus.in/bus-tickets/bhilwara-to-pushkar)
  - [Flamingo Travels: Kumbhalgarh](https://www.flamingotravels.co.in/blog/?p=14750)
- Highways (Wikipedia): [NH758](https://en.wikipedia.org/wiki/National_Highway_758_(India)), [NH58](https://en.wikipedia.org/wiki/National_Highway_58_(India)), [NH162](https://en.wikipedia.org/wiki/National_Highway_162_(India))
- Places and facts (Wikipedia):
  - Udaipur: [Udaipur](https://en.wikipedia.org/wiki/Udaipur), [History of Udaipur](https://en.wikipedia.org/wiki/History_of_Udaipur), [City Palace](https://en.wikipedia.org/wiki/City_Palace,_Udaipur), [Lake Palace](https://en.wikipedia.org/wiki/Lake_Palace), [Jag Mandir](https://en.wikipedia.org/wiki/Jag_Mandir)
  - Jaipur: [Jaipur](https://en.wikipedia.org/wiki/Jaipur), [Hawa Mahal](https://en.wikipedia.org/wiki/Hawa_Mahal), [Jantar Mantar](https://en.wikipedia.org/wiki/Jantar_Mantar,_Jaipur)
  - Forts: [Hill Forts of Rajasthan](https://en.wikipedia.org/wiki/Hill_Forts_of_Rajasthan), [Kumbhalgarh](https://en.wikipedia.org/wiki/Kumbhalgarh), [Chittor Fort](https://en.wikipedia.org/wiki/Chittor_Fort)
  - Pushkar: [Pushkar](https://en.wikipedia.org/wiki/Pushkar), [Pushkar Lake](https://en.wikipedia.org/wiki/Pushkar_Lake), [Brahma Temple](https://en.wikipedia.org/wiki/Brahma_Temple,_Pushkar), [Savitri Mata Mandir](https://en.wikipedia.org/wiki/Savitri_Mata_Mandir)
  - Mount Abu: [Abu Raj (formerly Mount Abu)](https://en.wikipedia.org/wiki/Abu_Raj), [Guru Shikhar](https://en.wikipedia.org/wiki/Guru_Shikhar), [Dilwara Temples](https://en.wikipedia.org/wiki/Dilwara_Temples)
  - Ranakpur: [Ranakpur Jain temple](https://en.wikipedia.org/wiki/Ranakpur_Jain_temple)
  - Nathdwara: [Nathdwara](https://en.wikipedia.org/wiki/Nathdwara), [Shrinathji Temple](https://en.wikipedia.org/wiki/Shrinathji_Temple), [Shrinathji](https://en.wikipedia.org/wiki/Shrinathji), [Statue of Belief](https://en.wikipedia.org/wiki/Statue_of_Belief)
- Visitor details:
  - Bagore ki Haveli: [rajasthandriver.com](https://www.rajasthandriver.com/tourist-attractions/udaipur/bagore-ki-haveli), [Tripoto](https://www.tripoto.com/gujarat/trips/dharohar-dance-show-at-bagore-ki-haveli-5e398e1de3e37)
  - Pushkar ropeway: [Outlook Traveller](https://www.outlooktraveller.com/destinations/india/from-camel-safaris-to-hot-air-ballooning-things-to-do-in-pushkar)
  - Pushkar fair dates: [Hindutone](https://hindutone.com/festivals/pushkar-fair-2026/), [SmartPuja (Kartik Purnima)](https://www.smartpuja.com/blog/kartik-purnima-2026/)
  - Abu Raj renaming: [Dynamite News](https://www.dynamitenews.com/national/rajasthan-cm-announces-name-change-for-three-cities-mount-abu-renamed-as-abu-raj-details-here), [Outlook Traveller](https://www.outlooktraveller.com/News/new-names-old-roots-rajasthan-renames-three-historic-places)
  - Dilwara timings: [Veena World](https://www.veenaworld.com/blog/dilwara-jain-temple-mount-abu-timings-location), [TravelTriangle](https://traveltriangle.com/rajasthan-tourism/mount-abu/places-to-visit/dilwara-temple/timings)
  - Kumbhalgarh show: [Thour Nature Resorts](https://www.thournatureresorts.com/blog/?p=2787), [Veena World](https://www.veenaworld.com/blog/kumbhalgarh-fort-entry-fees-history-architecture-timings)
  - Ranakpur visiting rules: [Veena World](https://www.veenaworld.com/blog/ranakpur-jain-temple-timing-history-and-information), [Holidify](https://www.holidify.com/places/ranakpur/tips-and-reviews.html), [Frommer's](https://www.frommers.com/destinations/udaipur/attractions/ranakpur-temples/)
  - Chittorgarh sound and light: [Incredible India](https://incredibleindia.gov.in/en/rajasthan/chittorgarh/chittorgarh-fort), [MakeMyTrip](https://www.makemytrip.com/tripideas/attractions/chittor-fort), [Wanderlog (reported suspended, undated)](https://wanderlog.com/place/details/2385978)
