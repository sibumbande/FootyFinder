export type BookableField = {
  id: string;
  name: string;
  address: string;
  surface: string;
  description: string;
  city: string;
  region: string;
  countryCode: string;
};

/** Temporary source. Replace this export with the fields API when field persistence is introduced. */
export const AVAILABLE_FIELDS: BookableField[] = [
  {
    id: 'green-point-arena',
    name: 'Green Point Arena',
    address: '1 Sports Way, Green Point',
    city: 'Cape Town',
    region: 'Western Cape',
    countryCode: 'ZA',
    surface: 'Premium artificial turf',
    description: 'Floodlit full-size pitch with secure parking and changing rooms.',
  },
  {
    id: 'riverside-football-park',
    name: 'Riverside Football Park',
    address: '24 River Road, Observatory',
    city: 'Cape Town',
    region: 'Western Cape',
    countryCode: 'ZA',
    surface: 'Natural grass',
    description: 'A classic grass field with covered team benches and spectator seating.',
  },
  {
    id: 'city-five-sports-ground',
    name: 'City Five Sports Ground',
    address: '88 Central Avenue, Gardens',
    city: 'Cape Town',
    region: 'Western Cape',
    countryCode: 'ZA',
    surface: 'Hybrid turf',
    description: 'Central, all-weather field with excellent evening lighting.',
  },
];

export const BOOKING_TIMES = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
