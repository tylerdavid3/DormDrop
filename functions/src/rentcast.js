'use strict';

const admin = require('firebase-admin');
const fetch = require('node-fetch');

// ─────────────────────────────────────────────────────────────────────────────
// RentCast API integration for DormDrop
// Endpoint: https://api.rentcast.io/v1/listings/rental/long-term
// ─────────────────────────────────────────────────────────────────────────────

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
const RENTCAST_BASE = 'https://api.rentcast.io/v1/listings/rental/long-term';

const SCHOOL_CONFIG = {
  bu: {
    school: 'bu',
    city: 'Boston',
    state: 'MA',
    lat: 42.3505,
    lng: -71.1054,
    radius: 2,          // miles
    bedroomsMin: 2,
    bedroomsMax: 5,
    neighborhoods: ['Allston', 'Brighton', 'Fenway', 'Back Bay']
  },
  neu: {
    school: 'neu',
    city: 'Boston',
    state: 'MA',
    lat: 42.3398,
    lng: -71.0892,
    radius: 2,
    bedroomsMin: 2,
    bedroomsMax: 5,
    neighborhoods: ['Mission Hill', 'Roxbury', 'Fenway']
  },
  merrimack: {
    school: 'merrimack',
    city: 'North Andover',
    state: 'MA',
    lat: 42.8334,
    lng: -71.0495,
    radius: 5,
    bedroomsMin: 2,
    bedroomsMax: 4,
    neighborhoods: []
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download a photo URL and upload to Firebase Storage.
 * Returns the public download URL, or null on failure.
 */
async function uploadPhotoToStorage(photoUrl, listingId, photoIndex) {
  try {
    const res = await fetch(photoUrl, { timeout: 15000 });
    if (!res.ok) return null;

    const buffer = await res.buffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';

    const bucket = admin.storage().bucket();
    const filePath = `listings/${listingId}/photo_${photoIndex}.${ext}`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
      metadata: { contentType },
      public: true
    });

    // Build the public URL directly (bucket is public-readable via storage rules)
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    return publicUrl;
  } catch (err) {
    console.warn(`Photo upload failed for listing ${listingId} photo ${photoIndex}:`, err.message);
    return null;
  }
}

/**
 * Fetch listings from RentCast API for a given lat/lng/radius.
 */
async function fetchRentCastListings(cfg, bedroomsMin, bedroomsMax) {
  if (!RENTCAST_API_KEY) throw new Error('RENTCAST_API_KEY environment variable is not set');

  const params = new URLSearchParams({
    latitude: cfg.lat,
    longitude: cfg.lng,
    radius: cfg.radius,
    bedrooms: bedroomsMin,         // RentCast filters by min bedrooms
    status: 'Active',
    limit: 50,
    offset: 0
  });

  const url = `${RENTCAST_BASE}?${params}`;
  console.log(`Fetching RentCast: ${url}`);

  const res = await fetch(url, {
    headers: {
      'X-Api-Key': RENTCAST_API_KEY,
      'Accept': 'application/json'
    },
    timeout: 30000
  });

  if (res.status === 429) throw new Error('RentCast rate limit hit');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`RentCast API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  // RentCast returns an array directly or { data: [...] }
  return Array.isArray(json) ? json : (json.data || json.listings || []);
}

/**
 * Map a RentCast listing object to our Firestore schema.
 */
function mapRentCastListing(item, cfg) {
  const rent = item.price || item.rentPrice || item.listPrice || 0;
  const beds = item.bedrooms || item.beds || 1;
  const baths = item.bathrooms || item.baths || 1;
  const sqft = item.squareFootage || item.sqft || item.livingArea || 0;

  const address = [item.addressLine1, item.addressLine2].filter(Boolean).join(', ')
    || item.address || item.fullAddress || '';

  return {
    address: address,
    city: item.city || cfg.city,
    state: item.state || cfg.state,
    zipCode: String(item.zipCode || item.zip || ''),
    neighborhood: item.county || '',
    school: cfg.school,
    rent: rent,
    rentPerPerson: beds > 0 ? Math.round(rent / beds) : rent,
    securityDeposit: item.securityDeposit || 0,
    brokerFee: 0,
    bedrooms: beds,
    bathrooms: baths,
    squareFeet: sqft,
    furnished: item.furnished || false,
    availableDate: item.availableDate || item.listedDate || '',
    leaseLength: 12,
    photos: [],                         // filled in after Storage upload
    virtualTour: item.url || '',
    amenities: {
      heatIncluded: item.utilities ? !!(item.utilities.heat) : false,
      hotWaterIncluded: item.utilities ? !!(item.utilities.hotWater) : false,
      laundryInUnit: !!(item.features && item.features.includes && item.features.includes('laundry')),
      laundryInBuilding: false,
      parking: !!(item.parkingSpaces && item.parkingSpaces > 0),
      dishwasher: false,
      ac: !!(item.features && item.features.includes && item.features.includes('cooling')),
      petsAllowed: item.petsAllowed || false
    },
    landlordId: 'system-rentcast',
    landlordName: item.brokerName || item.agentName || 'RentCast (imported)',
    landlordEmail: item.brokerEmail || '',
    landlordPhone: item.brokerPhone || item.agentPhone || '',
    rentcastId: String(item.id || item.listingId || ''),
    rentcastUrl: item.url || '',
    source: 'rentcast-api',
    verified: false,
    active: true,
    viewCount: 0,
    savedCount: 0,
    interestCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    coordinates: {
      lat: item.latitude || cfg.lat,
      lng: item.longitude || cfg.lng
    },
    distanceToSchool: 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core function: update listings for one school
// ─────────────────────────────────────────────────────────────────────────────

async function updateListingsForSchool(schoolKey) {
  const cfg = SCHOOL_CONFIG[schoolKey];
  if (!cfg) throw new Error(`Unknown school key: ${schoolKey}`);

  const db = admin.firestore();
  let listingsAdded = 0;
  let listingsUpdated = 0;
  let errors = 0;

  // Fetch from RentCast (paginate bedroomMin → bedroomMax in one call)
  let rawListings;
  try {
    rawListings = await fetchRentCastListings(cfg, cfg.bedroomsMin, cfg.bedroomsMax);
    console.log(`RentCast returned ${rawListings.length} listings for ${schoolKey}`);
  } catch (err) {
    console.error(`RentCast fetch failed for ${schoolKey}:`, err.message);
    throw err;
  }

  for (const item of rawListings) {
    try {
      const mapped = mapRentCastListing(item, cfg);
      if (!mapped.address || !mapped.rent) continue;

      // ── Check for duplicate by rentcastId or address ──
      let existingRef = null;

      if (mapped.rentcastId) {
        const byId = await db.collection('listings')
          .where('rentcastId', '==', mapped.rentcastId)
          .limit(1)
          .get();
        if (!byId.empty) existingRef = byId.docs[0].ref;
      }

      if (!existingRef) {
        const byAddr = await db.collection('listings')
          .where('address', '==', mapped.address)
          .where('school', '==', cfg.school)
          .limit(1)
          .get();
        if (!byAddr.empty) existingRef = byAddr.docs[0].ref;
      }

      // ── Download up to 5 photos → Firebase Storage ──
      const sourcePhotos = Array.isArray(item.photos)
        ? item.photos.slice(0, 5)
        : (item.photoUrls || item.images || []).slice(0, 5);

      const listingDocId = existingRef ? existingRef.id : db.collection('listings').doc().id;
      const uploadedPhotos = [];

      for (let i = 0; i < sourcePhotos.length; i++) {
        const photoUrl = typeof sourcePhotos[i] === 'string'
          ? sourcePhotos[i]
          : (sourcePhotos[i].url || sourcePhotos[i].href || '');
        if (!photoUrl) continue;
        const stored = await uploadPhotoToStorage(photoUrl, listingDocId, i);
        if (stored) uploadedPhotos.push(stored);
      }

      mapped.photos = uploadedPhotos;

      // ── Write to Firestore ──
      if (existingRef) {
        await existingRef.update({
          rent: mapped.rent,
          rentPerPerson: mapped.rentPerPerson,
          photos: uploadedPhotos.length > 0 ? uploadedPhotos : admin.firestore.FieldValue.delete(),
          active: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        listingsUpdated++;
      } else {
        await db.collection('listings').doc(listingDocId).set(mapped);
        listingsAdded++;
      }
    } catch (itemErr) {
      console.error('Error processing listing:', itemErr.message, JSON.stringify(item).slice(0, 120));
      errors++;
    }
  }

  return {
    success: true,
    school: schoolKey,
    listingsAdded,
    listingsUpdated,
    errors,
    total: rawListings.length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported functions (used by index.js)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { updateListingsForSchool, SCHOOL_CONFIG };
