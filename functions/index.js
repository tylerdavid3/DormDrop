const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { processSchool, SCHOOL_CONFIG, getApiKey } = require('./src/rentcast');

admin.initializeApp();

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'dormdrop.business@gmail.com';

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
}

// ─────────────────────────────────────────────────────────────────
// Zillow internal JSON search API
// Fetches structured listing data including photos, beds, baths, sqft
// ─────────────────────────────────────────────────────────────────

const SCHOOLS = {
  bu: {
    school: 'bu',
    lat: 42.3505,
    lng: -71.1054,
    radiusDeg: 0.03,
    city: 'Boston',
    state: 'MA'
  },
  neu: {
    school: 'neu',
    lat: 42.3398,
    lng: -71.0892,
    radiusDeg: 0.03,
    city: 'Boston',
    state: 'MA'
  },
  merrimack: {
    school: 'merrimack',
    lat: 42.8334,
    lng: -71.0495,
    radiusDeg: 0.04,
    city: 'North Andover',
    state: 'MA'
  }
};

/**
 * Build the Zillow search query URL for rentals in a bounding box.
 */
function buildZillowUrl(cfg) {
  const searchQueryState = {
    pagination: {},
    isMapVisible: true,
    isListVisible: true,
    mapBounds: {
      north: cfg.lat + cfg.radiusDeg,
      south: cfg.lat - cfg.radiusDeg,
      east: cfg.lng + cfg.radiusDeg,
      west: cfg.lng - cfg.radiusDeg
    },
    filterState: {
      isForRent: { value: true },
      isForSaleByAgent: { value: false },
      isForSaleByOwner: { value: false },
      isNewConstruction: { value: false },
      isComingSoon: { value: false },
      isAuction: { value: false },
      isForSaleForclosure: { value: false }
    }
  };
  return 'https://www.zillow.com/search/GetSearchPageState.htm?searchQueryState=' +
    encodeURIComponent(JSON.stringify(searchQueryState)) +
    '&wants={"cat1":["listResults","mapResults"]}&requestId=1';
}

/**
 * Parse a price string like "$1,500/mo" → integer 1500.
 */
function parseRent(priceStr) {
  if (!priceStr) return 0;
  return parseInt(String(priceStr).replace(/[^0-9]/g, ''), 10) || 0;
}

/**
 * Best-effort neighborhood from address, e.g.
 * "123 Main St, Allston, Boston, MA 02134" → "Allston"
 */
function extractNeighborhood(addr) {
  if (!addr) return '';
  const parts = addr.split(',');
  return parts.length >= 2 ? parts[1].trim() : '';
}

/**
 * Fetch Zillow listings for one school using the internal JSON API.
 */
async function fetchZillowListings(cfg) {
  const url = buildZillowUrl(cfg);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.zillow.com/',
    'Cache-Control': 'no-cache'
  };

  const res = await fetch(url, { headers, timeout: 30000 });
  if (!res.ok) {
    console.warn('Zillow returned', res.status, 'for', cfg.school);
    return [];
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    console.warn('Zillow JSON parse error for', cfg.school, e.message);
    return [];
  }

  const listResults = (json.cat1 &&
    json.cat1.searchResults &&
    json.cat1.searchResults.listResults) || [];
  return listResults.slice(0, 20);
}

/**
 * Map a Zillow listResult to our Firestore listing schema.
 * Returns null if rent or address is missing.
 */
function mapListing(item, cfg) {
  const rent = parseRent(item.price || item.unformattedPrice);
  if (!rent) return null;

  const address = item.address || item.streetAddress || '';
  if (!address) return null;

  // Photos: imgSrc is thumbnail, carouselPhotos[] are full-size
  const photos = [];
  if (item.imgSrc) photos.push(item.imgSrc);
  if (Array.isArray(item.carouselPhotos)) {
    item.carouselPhotos.forEach(function(p) {
      const photoUrl = typeof p === 'string' ? p : (p.url || p.src || '');
      if (photoUrl && !photos.includes(photoUrl)) photos.push(photoUrl);
    });
  }

  const beds = parseInt(item.beds, 10) || parseInt(item.bedrooms, 10) || 1;
  const baths = parseFloat(item.baths) || parseFloat(item.bathrooms) || 1;
  const sqft = parseInt(item.area || item.livingArea, 10) || 0;

  return {
    address: address,
    city: cfg.city,
    state: cfg.state,
    zipCode: item.zipcode || '',
    neighborhood: extractNeighborhood(address),
    school: cfg.school,
    rent: rent,
    rentPerPerson: rent,
    securityDeposit: 0,
    brokerFee: 0,
    bedrooms: beds,
    bathrooms: baths,
    squareFeet: sqft,
    furnished: false,
    availableDate: '',
    leaseLength: 12,
    photos: photos.slice(0, 10),
    virtualTour: item.hdpUrl ? 'https://www.zillow.com' + item.hdpUrl : '',
    amenities: {
      heatIncluded: false,
      hotWaterIncluded: false,
      laundryInUnit: false,
      laundryInBuilding: false,
      parking: false,
      dishwasher: false,
      ac: false,
      petsAllowed: false
    },
    landlordId: 'system-zillow',
    landlordName: 'Zillow (imported)',
    landlordEmail: '',
    landlordPhone: '',
    zillowId: String(item.zpid || ''),
    zillowUrl: item.hdpUrl ? 'https://www.zillow.com' + item.hdpUrl : '',
    source: 'zillow-scraped',
    verified: false,
    active: true,
    viewCount: 0,
    savedCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    coordinates: { lat: cfg.lat, lng: cfg.lng },
    distanceToSchool: 0
  };
}

/**
 * Scheduled Zillow scrape — runs every 24 hours.
 * Uses Zillow's internal JSON API; deduplicates by zpid.
 */
exports.scrapeZillowNearSchool = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 24 hours')
  .onRun(async () => {
    const db = admin.firestore();

    for (const key of Object.keys(SCHOOLS)) {
      const cfg = SCHOOLS[key];
      console.log('Scraping Zillow for', key);

      let items;
      try {
        items = await fetchZillowListings(cfg);
        console.log('Got', items.length, 'results for', key);
      } catch (e) {
        console.error('Fetch error for', key, e.message);
        continue;
      }

      if (!items.length) continue;

      const batch = db.batch();
      let newCount = 0;

      for (const item of items) {
        const mapped = mapListing(item, cfg);
        if (!mapped) continue;

        if (mapped.zillowId) {
          const existing = await db.collection('listings')
            .where('zillowId', '==', mapped.zillowId)
            .limit(1)
            .get();
          if (!existing.empty) {
            // Update rent and photos in case they changed
            batch.update(existing.docs[0].ref, {
              photos: mapped.photos,
              rent: mapped.rent,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            continue;
          }
        }

        const ref = db.collection('listings').doc();
        batch.set(ref, mapped);
        newCount++;
      }

      await batch.commit();
      console.log('Committed', newCount, 'new listings for', key);

      // Polite delay between school requests
      await new Promise(r => setTimeout(r, 2000));
    }

    return null;
  });

/**
 * HTTP trigger to manually run the scraper (for testing / seeding).
 * GET /scrapeZillowManual?school=bu
 */
exports.scrapeZillowManual = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const schoolKey = req.query.school || 'bu';
    const cfg = SCHOOLS[schoolKey];
    if (!cfg) { res.status(400).json({ error: 'Unknown school key' }); return; }

    const db = admin.firestore();
    let items;
    try {
      items = await fetchZillowListings(cfg);
    } catch (e) {
      res.status(500).json({ error: e.message });
      return;
    }

    const results = [];
    const batch = db.batch();
    for (const item of items) {
      const mapped = mapListing(item, cfg);
      if (!mapped) continue;
      const ref = db.collection('listings').doc();
      batch.set(ref, mapped);
      results.push({
        address: mapped.address,
        rent: mapped.rent,
        beds: mapped.bedrooms,
        baths: mapped.bathrooms,
        sqft: mapped.squareFeet,
        photos: mapped.photos.length,
        zillowUrl: mapped.zillowUrl
      });
    }
    await batch.commit();
    res.json({ school: schoolKey, saved: results.length, listings: results });
  });

/**
 * SendGrid: notify landlord on new student interest (interests collection).
 */
exports.onNewInterestEmail = functions.firestore
  .document('interests/{interestId}')
  .onCreate(async (snap) => {
    if (!SENDGRID_KEY) { console.info('SendGrid not configured; skipping.'); return null; }
    const data = snap.data();
    if (!data.landlordId) return null;

    const userDoc = await admin.firestore().collection('users').doc(data.landlordId).get();
    const email = userDoc.exists ? userDoc.data().email : null;
    if (!email) return null;

    await sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: 'New interest in your listing — DormDrop',
      text: [
        `${data.studentName || 'A student'} is interested in your listing at ${data.listingAddress || data.listingId}.`,
        '',
        data.message ? `Message: "${data.message}"` : '',
        '',
        `Reply to: ${data.studentEmail || '(not provided)'}`,
        '',
        'Log in at mydormdrop.com/landlord to view all inquiries.'
      ].join('\n')
    });
    return null;
  });

/**
 * Legacy: also handle inquiries collection.
 */
exports.onNewInquiryEmail = functions.firestore
  .document('inquiries/{inquiryId}')
  .onCreate(async (snap) => {
    if (!SENDGRID_KEY) { console.info('SendGrid not configured; skipping.'); return null; }
    const data = snap.data();
    if (!data.landlordId) return null;

    const userDoc = await admin.firestore().collection('users').doc(data.landlordId).get();
    const email = userDoc.exists ? userDoc.data().email : null;
    if (!email) return null;

    await sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: `New DormDrop inquiry: ${data.listingId || 'listing'}`,
      text: `You have a new inquiry from ${data.studentName || 'a student'}.\n\n${data.message || ''}\n\nReply to: ${data.studentEmail || ''}`
    });
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// RentCast API — listing sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared handler used by all RentCast HTTP endpoints.
 * Validates API key, runs processSchool(), returns detailed JSON.
 */
async function runSchoolSync(schoolKey, res) {
  res.set('Access-Control-Allow-Origin', '*');

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: 'RENTCAST_API_KEY not configured.',
      fix: 'Set it in GitHub Actions secrets as RENTCAST_API_KEY, then redeploy. Or run: firebase functions:config:set rentcast.api_key="YOUR_KEY"',
    });
  }

  if (!SCHOOL_CONFIG[schoolKey]) {
    return res.status(400).json({
      success: false,
      error: `Invalid school "${schoolKey}". Valid values: ${Object.keys(SCHOOL_CONFIG).join(', ')}`,
    });
  }

  try {
    const result = await processSchool(schoolKey, apiKey);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[${schoolKey}] Fatal error:`, err.message);
    return res.status(500).json({
      success: false,
      school: schoolKey,
      error: err.message,
      stack: err.stack,
    });
  }
}

/**
 * GET /fetchListingsForSchool?school=bu
 * GET /updateListingsForSchool?school=bu  (alias)
 */
exports.fetchListingsForSchool = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    const school = (req.query.school || '').toLowerCase().trim();
    await runSchoolSync(school, res);
  });

exports.updateListingsForSchool = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    const school = (req.query.school || '').toLowerCase().trim();
    await runSchoolSync(school, res);
  });

/**
 * GET /updateAllListings
 * GET /fetchAllListings  (alias)
 * Runs all three schools sequentially with a 3-second pause between.
 */
async function runAllSchools(res) {
  res.set('Access-Control-Allow-Origin', '*');

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: 'RENTCAST_API_KEY not configured.',
      fix: 'Set GitHub Actions secret RENTCAST_API_KEY and redeploy.',
    });
  }

  const results = {};
  let totalAdded = 0, totalUpdated = 0, totalErrors = 0;

  for (const schoolKey of Object.keys(SCHOOL_CONFIG)) {
    try {
      const r = await processSchool(schoolKey, apiKey);
      results[schoolKey] = { success: true, ...r };
      totalAdded   += r.added   || 0;
      totalUpdated += r.updated || 0;
      totalErrors  += (r.errors || []).length;
    } catch (err) {
      console.error(`[${schoolKey}] error:`, err.message);
      results[schoolKey] = { success: false, school: schoolKey, error: err.message };
      totalErrors++;
    }
    // Polite pause — avoid RentCast rate limits
    await new Promise(r => setTimeout(r, 3000));
  }

  return res.json({ success: true, results, totalAdded, totalUpdated, totalErrors });
}

exports.updateAllListings = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => { await runAllSchools(res); });

exports.fetchAllListings = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => { await runAllSchools(res); });

/**
 * Scheduled: daily at 3 AM Eastern.
 */
exports.scheduledListingsSync = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const apiKey = getApiKey();
    if (!apiKey) { console.error('scheduledListingsSync: no API key configured'); return null; }

    for (const schoolKey of Object.keys(SCHOOL_CONFIG)) {
      try {
        const r = await processSchool(schoolKey, apiKey);
        console.log(`scheduledListingsSync [${schoolKey}]:`, JSON.stringify(r));
      } catch (err) {
        console.error(`scheduledListingsSync [${schoolKey}] failed:`, err.message);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    return null;
  });
