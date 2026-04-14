/**
 * DormDrop — RentCast Listing Seeder
 * Run this from your Mac to populate Firestore with real listings.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=../service-account.json node seed-listings.js
 */

'use strict';

const admin = require('firebase-admin');
const axios = require('axios');

// ── Config ────────────────────────────────────────────────────────────────────

const RENTCAST_API_KEY = '8a7a84a4576544308f45afe6bf99c9f2';
const FIREBASE_PROJECT  = 'dormdrop-98dd3';
const RENTCAST_BASE     = 'https://api.rentcast.io/v1/listings/rental/long-term';

const SCHOOLS = {
  bu: {
    label: 'Boston University',
    lat: 42.3505, lng: -71.1054, radius: 3,
    bedroomsMin: 2, city: 'Boston', state: 'MA',
  },
  neu: {
    label: 'Northeastern University',
    lat: 42.3398, lng: -71.0892, radius: 3,
    bedroomsMin: 2, city: 'Boston', state: 'MA',
  },
  merrimack: {
    label: 'Merrimack College',
    lat: 42.8334, lng: -71.0495, radius: 5,
    bedroomsMin: 2, city: 'North Andover', state: 'MA',
  },
};

// ── Init Firebase ─────────────────────────────────────────────────────────────

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('\nERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.');
  console.error('Example: GOOGLE_APPLICATION_CREDENTIALS=../service-account.json node seed-listings.js\n');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: FIREBASE_PROJECT,
});

const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function mapListing(item, school, cfg) {
  const rent  = Number(item.price || item.listPrice || 0);
  const beds  = Number(item.bedrooms || 1);
  const baths = Number(item.bathrooms || 1);
  const sqft  = Number(item.squareFootage || item.livingArea || 0);
  const lat   = Number(item.latitude  || cfg.lat);
  const lng   = Number(item.longitude || cfg.lng);

  const address = (
    [item.addressLine1, item.addressLine2].filter(Boolean).join(', ') ||
    item.formattedAddress || item.address || ''
  ).trim();

  const photoUrls = (item.photoUrls || item.photos || [])
    .slice(0, 5)
    .map(p => typeof p === 'string' ? p : (p.url || ''))
    .filter(Boolean);

  return {
    address,
    city:  item.city  || cfg.city,
    state: item.state || cfg.state,
    zipCode: String(item.zipCode || ''),
    neighborhood: item.city || cfg.city,
    school,
    rent,
    rentPerPerson: beds > 0 ? Math.round(rent / beds) : rent,
    bedrooms: beds,
    bathrooms: baths,
    squareFeet: sqft,
    furnished: false,
    description: item.description || '',
    photos: photoUrls,   // storing raw URLs (no Storage upload in this script)
    availableDate: item.listedDate || '2026-09-01',
    leaseLength: 12,
    amenities: {
      heatIncluded: false, hotWaterIncluded: false,
      laundryInUnit: false, laundryInBuilding: false,
      parking: !!(item.parkingSpaces > 0),
      dishwasher: false, ac: false,
      petsAllowed: !!(item.petsAllowed),
    },
    landlordId: null,
    landlordName: item.agentName || 'Contact via DormDrop',
    landlordEmail: item.agentEmail || 'inquiries@mydormdrop.com',
    landlordPhone: item.agentPhone || '',
    rentcastId: String(item.id || ''),
    source: 'rentcast-api',
    verified: false,
    active: true,
    viewCount: 0,
    savedCount: 0,
    interestCount: 0,
    coordinates: { lat, lng },
    distanceToSchool: Math.round(haversine(lat, lng, cfg.lat, cfg.lng) * 10) / 10,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seedSchool(school, cfg) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Seeding ${cfg.label}...`);

  // Call RentCast
  let listings = [];
  try {
    const resp = await axios.get(RENTCAST_BASE, {
      params: {
        latitude:  cfg.lat,
        longitude: cfg.lng,
        radius:    cfg.radius,
        bedrooms:  cfg.bedroomsMin,
        status:    'Active',
        limit:     500,
      },
      headers: { 'X-Api-Key': RENTCAST_API_KEY, Accept: 'application/json' },
      timeout: 30000,
      validateStatus: null,
    });

    if (resp.status === 401 || resp.status === 403) {
      console.error(`  API key rejected: ${JSON.stringify(resp.data).slice(0, 200)}`);
      return { added: 0, updated: 0, errors: 1 };
    }
    if (resp.status !== 200) {
      console.error(`  API error ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
      return { added: 0, updated: 0, errors: 1 };
    }

    const data = resp.data;
    listings = Array.isArray(data) ? data : (data.data || data.listings || []);
    console.log(`  RentCast returned ${listings.length} listings`);

    if (listings.length === 0) {
      console.log(`  No listings returned. Sample response: ${JSON.stringify(data).slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`  API call failed: ${err.message}`);
    return { added: 0, updated: 0, errors: 1 };
  }

  let added = 0, updated = 0, errors = 0;

  for (let i = 0; i < listings.length; i++) {
    const item = listings[i];
    try {
      const mapped = mapListing(item, school, cfg);
      if (!mapped.address || !mapped.rent || mapped.rent < 100) continue;

      process.stdout.write(`  [${i+1}/${listings.length}] ${mapped.address} — $${mapped.rent}/mo ... `);

      // Check for existing
      let existingRef = null;
      if (mapped.rentcastId) {
        const snap = await db.collection('listings')
          .where('rentcastId', '==', mapped.rentcastId).limit(1).get();
        if (!snap.empty) existingRef = snap.docs[0].ref;
      }
      if (!existingRef) {
        const snap = await db.collection('listings')
          .where('address', '==', mapped.address)
          .where('school', '==', school).limit(1).get();
        if (!snap.empty) existingRef = snap.docs[0].ref;
      }

      if (existingRef) {
        await existingRef.update({
          rent: mapped.rent, rentPerPerson: mapped.rentPerPerson,
          active: true, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        process.stdout.write('UPDATED\n');
        updated++;
      } else {
        await db.collection('listings').add(mapped);
        process.stdout.write('ADDED\n');
        added++;
      }
    } catch (err) {
      process.stdout.write(`ERROR: ${err.message}\n`);
      errors++;
    }
  }

  console.log(`  Done: +${added} added, ~${updated} updated, ${errors} errors`);
  return { added, updated, errors };
}

async function main() {
  console.log('\n=== DormDrop Listing Seeder ===');
  console.log(`Project: ${FIREBASE_PROJECT}`);
  console.log(`API Key: ${RENTCAST_API_KEY.slice(0, 8)}...`);

  const school = process.argv[2] || 'all';
  const schoolsToRun = school === 'all' ? Object.keys(SCHOOLS) : [school];

  let totalAdded = 0, totalUpdated = 0;

  for (const key of schoolsToRun) {
    if (!SCHOOLS[key]) { console.error(`Unknown school: ${key}`); continue; }
    const result = await seedSchool(key, SCHOOLS[key]);
    totalAdded   += result.added;
    totalUpdated += result.updated;
    if (schoolsToRun.length > 1) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`TOTAL: +${totalAdded} added, ~${totalUpdated} updated`);
  console.log('Done! Check Firestore console to verify listings.');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
