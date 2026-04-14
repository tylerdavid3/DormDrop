'use strict';

/**
 * DormDrop — RentCast API Integration
 * ------------------------------------
 * Fetches long-term rental listings from api.rentcast.io, stores
 * photos in Firebase Storage, and writes/updates records in Firestore.
 *
 * HTTP endpoints (exported via index.js):
 *   GET /fetchListingsForSchool?school=bu
 *   GET /updateAllListings
 *   GET /fetchAllListings    (alias)
 *
 * Scheduled:
 *   scheduledListingsSync   (daily 3 AM Eastern)
 */

const admin   = require('firebase-admin');
const axios   = require('axios');
const functions = require('firebase-functions');

// ─────────────────────────────────────────────────────────────────────────────
// API key: prefer .env (set by GitHub Actions), fall back to functions.config()
// ─────────────────────────────────────────────────────────────────────────────
function getApiKey() {
  const envKey = process.env.RENTCAST_API_KEY;
  if (envKey && envKey.length > 10) return envKey;

  try {
    const cfg = functions.config();
    if (cfg.rentcast && cfg.rentcast.api_key) return cfg.rentcast.api_key;
  } catch (_) {}

  return null;
}

const RENTCAST_BASE = 'https://api.rentcast.io/v1/listings/rental/long-term';

// ─────────────────────────────────────────────────────────────────────────────
// School config
// ─────────────────────────────────────────────────────────────────────────────
const SCHOOL_CONFIG = {
  bu: {
    school: 'bu',
    label: 'Boston University',
    city: 'Boston',
    state: 'MA',
    lat: 42.3505,
    lng: -71.1054,
    radius: 3,
    bedroomsMin: 2,
    bedroomsMax: 5,
  },
  neu: {
    school: 'neu',
    label: 'Northeastern University',
    city: 'Boston',
    state: 'MA',
    lat: 42.3398,
    lng: -71.0892,
    radius: 3,
    bedroomsMin: 2,
    bedroomsMax: 5,
  },
  merrimack: {
    school: 'merrimack',
    label: 'Merrimack College',
    city: 'North Andover',
    state: 'MA',
    lat: 42.8334,
    lng: -71.0495,
    radius: 5,
    bedroomsMin: 2,
    bedroomsMax: 4,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance (miles)
// ─────────────────────────────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────────────────────
// Neighborhood detection from address string
// ─────────────────────────────────────────────────────────────────────────────
const NEIGHBORHOODS = [
  'Allston', 'Brighton', 'Fenway', 'Back Bay', 'Brookline',
  'Mission Hill', 'Roxbury', 'Jamaica Plain', 'South End',
  'Kenmore', 'Coolidge Corner', 'Longwood',
  'North Andover', 'Andover', 'Lawrence', 'Methuen',
];

function detectNeighborhood(address, city) {
  if (!address) return city || '';
  const addr = address.toLowerCase();
  for (const n of NEIGHBORHOODS) {
    if (addr.includes(n.toLowerCase())) return n;
  }
  return city || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Download photo and upload to Firebase Storage
// Returns public URL or null on failure
// ─────────────────────────────────────────────────────────────────────────────
async function uploadPhotoToStorage(photoUrl, listingDocId, photoIndex) {
  try {
    console.log(`    Photo ${photoIndex + 1}: downloading ${photoUrl.slice(0, 80)}...`);

    const response = await axios.get(photoUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { 'User-Agent': 'DormDrop/1.0' },
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const buffer = Buffer.from(response.data);

    const bucket = admin.storage().bucket();
    const filePath = `listings/${listingDocId}/photo_${photoIndex}.${ext}`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
      metadata: { contentType, cacheControl: 'public,max-age=31536000' },
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    console.log(`    Photo ${photoIndex + 1}: uploaded → ${publicUrl.slice(0, 80)}`);
    return publicUrl;
  } catch (err) {
    console.warn(`    Photo ${photoIndex + 1}: FAILED (${err.message}) — skipping`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Call RentCast API
// ─────────────────────────────────────────────────────────────────────────────
async function callRentCastAPI(cfg, apiKey) {
  const params = {
    latitude:  cfg.lat,
    longitude: cfg.lng,
    radius:    cfg.radius,
    bedrooms:  cfg.bedroomsMin,
    status:    'Active',
    limit:     500,
    offset:    0,
  };

  const url = RENTCAST_BASE;
  console.log(`[RentCast] GET ${url} params: ${JSON.stringify(params)}`);

  const response = await axios.get(url, {
    params,
    headers: {
      'X-Api-Key': apiKey,
      'Accept': 'application/json',
    },
    timeout: 30000,
    validateStatus: null, // Don't throw on non-2xx so we can read the body
  });

  console.log(`[RentCast] Response status: ${response.status}`);

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `API key rejected (HTTP ${response.status}). ` +
      `Response: ${JSON.stringify(response.data).slice(0, 300)}`
    );
  }
  if (response.status === 429) {
    throw new Error('RentCast rate limit exceeded (HTTP 429). Wait and retry.');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `RentCast API error HTTP ${response.status}: ` +
      `${JSON.stringify(response.data).slice(0, 300)}`
    );
  }

  const data = response.data;
  // API can return array directly or { data: [...] } or { listings: [...] }
  const listings = Array.isArray(data)
    ? data
    : (data.data || data.listings || []);

  console.log(`[RentCast] Received ${listings.length} listings for ${cfg.school}`);
  return listings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map RentCast listing → Firestore document
// ─────────────────────────────────────────────────────────────────────────────
function mapListing(item, cfg) {
  const rent  = Number(item.price || item.listPrice || item.rentPrice || 0);
  const beds  = Number(item.bedrooms || item.beds || 1);
  const baths = Number(item.bathrooms || item.baths || 1);
  const sqft  = Number(item.squareFootage || item.livingArea || item.sqft || 0);

  // Build address string
  const address = (
    [item.addressLine1, item.addressLine2].filter(Boolean).join(', ') ||
    item.formattedAddress ||
    item.address ||
    ''
  ).trim();

  const city  = item.city  || cfg.city;
  const state = item.state || cfg.state;
  const zip   = String(item.zipCode || item.zip || '');

  const lat = Number(item.latitude  || cfg.lat);
  const lng = Number(item.longitude || cfg.lng);

  const distanceMiles = haversine(lat, lng, cfg.lat, cfg.lng);

  // Amenities
  const feats = Array.isArray(item.features) ? item.features.map(f => String(f).toLowerCase()) : [];
  const utils = item.utilities || {};

  const amenities = {
    heatIncluded:    !!(utils.heat || utils.Heat),
    hotWaterIncluded:!!(utils.hotWater || utils.HotWater),
    laundryInUnit:   feats.some(f => f.includes('laundry') || f.includes('washer')),
    laundryInBuilding: feats.some(f => f.includes('laundry in building')),
    parking:         !!(item.parkingSpaces > 0) || feats.some(f => f.includes('parking')),
    dishwasher:      feats.some(f => f.includes('dishwasher')),
    ac:              feats.some(f => f.includes('air') || f.includes('cooling') || f.includes('a/c')),
    petsAllowed:     !!(item.petsAllowed),
  };

  // Photos: RentCast can return photoUrls, photos, or images array
  const rawPhotos = (
    item.photoUrls ||
    item.photos    ||
    item.images    ||
    []
  ).slice(0, 5);

  const photoUrls = rawPhotos.map(p =>
    typeof p === 'string' ? p : (p.url || p.href || p.src || '')
  ).filter(Boolean);

  return {
    address,
    city,
    state,
    zipCode: zip,
    neighborhood: detectNeighborhood(`${address} ${city}`, city),
    school:  cfg.school,

    rent,
    rentPerPerson: beds > 0 ? Math.round(rent / beds) : rent,
    securityDeposit: Number(item.securityDeposit || 0),
    brokerFee: 0,

    bedrooms:    beds,
    bathrooms:   baths,
    squareFeet:  sqft,
    furnished:   !!(item.furnished),
    description: item.description || '',

    availableDate: item.availableDate || item.listedDate || '2026-09-01',
    leaseLength:   12,

    photos:     [],  // filled in after Storage upload
    photoUrls,       // raw URLs for reference (not saved to Firestore schema)

    amenities,

    landlordId:    null,
    landlordName:  item.brokerName || item.agentName || 'Contact via DormDrop',
    landlordEmail: item.brokerEmail || item.agentEmail || 'inquiries@mydormdrop.com',
    landlordPhone: item.brokerPhone || item.agentPhone || '',

    rentcastId:  String(item.id || item.listingId || ''),
    rentcastUrl: item.url || item.listingUrl || '',
    source:      'rentcast-api',
    verified:    false,
    active:      true,
    viewCount:   0,
    savedCount:  0,
    interestCount: 0,

    coordinates: { lat, lng },
    distanceToSchool: Math.round(distanceMiles * 10) / 10,

    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: fetch + process + store listings for one school
// ─────────────────────────────────────────────────────────────────────────────
async function processSchool(schoolKey, apiKey) {
  const cfg = SCHOOL_CONFIG[schoolKey];
  if (!cfg) throw new Error(`Unknown school key "${schoolKey}". Valid: ${Object.keys(SCHOOL_CONFIG).join(', ')}`);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Processing school: ${cfg.label} (${schoolKey})`);
  console.log(`${'═'.repeat(60)}`);

  // 1. Call RentCast
  const rawListings = await callRentCastAPI(cfg, apiKey);
  if (rawListings.length === 0) {
    console.log(`[${schoolKey}] No listings returned from API.`);
    return { school: schoolKey, apiListings: 0, added: 0, updated: 0, skipped: 0, errors: [] };
  }

  const db = admin.firestore();
  let added = 0, updated = 0, skipped = 0;
  const errors = [];

  // 2. Process each listing
  for (let i = 0; i < rawListings.length; i++) {
    const item = rawListings[i];
    console.log(`\n[${schoolKey}] Listing ${i + 1}/${rawListings.length}: ${item.addressLine1 || item.address || item.id || 'unknown'}`);

    try {
      const mapped = mapListing(item, cfg);

      if (!mapped.address) {
        console.log(`  SKIP: no address`);
        skipped++;
        continue;
      }
      if (!mapped.rent || mapped.rent < 100) {
        console.log(`  SKIP: rent is ${mapped.rent} (too low or missing)`);
        skipped++;
        continue;
      }

      // 3. Deduplicate: check by rentcastId, then by address+school
      let existingRef = null;
      let existingSource = null;

      if (mapped.rentcastId) {
        const snap = await db.collection('listings')
          .where('rentcastId', '==', mapped.rentcastId)
          .limit(1).get();
        if (!snap.empty) {
          existingRef    = snap.docs[0].ref;
          existingSource = snap.docs[0].data().source;
        }
      }

      if (!existingRef) {
        const snap = await db.collection('listings')
          .where('address', '==', mapped.address)
          .where('school', '==', cfg.school)
          .limit(1).get();
        if (!snap.empty) {
          existingRef    = snap.docs[0].ref;
          existingSource = snap.docs[0].data().source;
        }
      }

      // Don't overwrite landlord-submitted listings
      if (existingRef && existingSource === 'landlord') {
        console.log(`  SKIP: landlord-owned listing at same address`);
        skipped++;
        continue;
      }

      // 4. Upload photos to Firebase Storage
      const docId = existingRef ? existingRef.id : db.collection('listings').doc().id;
      const uploadedPhotos = [];

      if (mapped.photoUrls && mapped.photoUrls.length > 0) {
        console.log(`  Photos: uploading ${mapped.photoUrls.length} photo(s)...`);
        for (let pi = 0; pi < mapped.photoUrls.length; pi++) {
          const url = await uploadPhotoToStorage(mapped.photoUrls[pi], docId, pi);
          if (url) uploadedPhotos.push(url);
        }
        console.log(`  Photos: ${uploadedPhotos.length}/${mapped.photoUrls.length} uploaded successfully`);
      } else {
        console.log(`  Photos: none provided by API`);
      }

      // Remove helper field before saving
      delete mapped.photoUrls;
      mapped.photos = uploadedPhotos;

      // 5. Write to Firestore
      if (existingRef) {
        await existingRef.update({
          rent:          mapped.rent,
          rentPerPerson: mapped.rentPerPerson,
          photos:        uploadedPhotos.length > 0 ? uploadedPhotos : admin.firestore.FieldValue.delete(),
          active:        true,
          description:   mapped.description,
          updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`  UPDATED doc ${existingRef.id}`);
        updated++;
      } else {
        await db.collection('listings').doc(docId).set(mapped);
        console.log(`  ADDED doc ${docId}`);
        added++;
      }

    } catch (err) {
      const msg = `Listing ${i + 1} (${item.addressLine1 || item.id}): ${err.message}`;
      console.error(`  ERROR: ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`\n[${schoolKey}] Done: +${added} added, ~${updated} updated, =${skipped} skipped, ${errors.length} errors`);

  return {
    school:      schoolKey,
    apiListings: rawListings.length,
    added,
    updated,
    skipped,
    errors,
    sampleRaw:   rawListings[0] || null,  // First raw API item for debugging
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports — called from index.js
// ─────────────────────────────────────────────────────────────────────────────
module.exports = { processSchool, SCHOOL_CONFIG, getApiKey };
