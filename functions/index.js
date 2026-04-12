const functions = require('firebase-functions');
const admin = require('firebase-admin');
const puppeteer = require('puppeteer');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'hello@mydormdrop.com';

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
}

/**
 * Scheduled Zillow scrape near a school (coordinates + radius).
 * Writes to `listings` with source: zillow-scraped.
 */
exports.scrapeZillowNearSchool = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .pubsub.schedule('every 24 hours')
  .onRun(async () => {
    const schools = {
      bu: { lat: 42.3505, lng: -71.1054, school: 'bu' },
      neu: { lat: 42.3398, lng: -71.0892, school: 'neu' },
      merrimack: { lat: 42.8334, lng: -71.0495, school: 'merrimack' }
    };

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (compatible; DormDropBot/1.0; +https://mydormdrop.com)'
      );

      for (const key of Object.keys(schools)) {
        const cfg = schools[key];
        const url = `https://www.zillow.com/homes/for_rent/?searchQueryState=%7B%22mapBounds%22%3A%7B%22north%22%3A${cfg.lat + 0.05}%2C%22south%22%3A${cfg.lat - 0.05}%2C%22east%22%3A${cfg.lng + 0.05}%2C%22west%22%3A${cfg.lng - 0.05}%7D%7D`;

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 }).catch(() => {});

        const items = await page
          .evaluate(() => {
            const out = [];
            document.querySelectorAll('[data-test="property-card"]').forEach((el, i) => {
              if (i >= 15) return;
              const priceEl = el.querySelector('[data-test="property-card-price"]');
              const addrEl = el.querySelector('[data-test="property-card-addr"]');
              out.push({
                priceText: priceEl ? priceEl.textContent.trim() : '',
                addressText: addrEl ? addrEl.textContent.trim() : ''
              });
            });
            return out;
          })
          .catch(() => []);

        const batch = admin.firestore().batch();
        for (const item of items) {
          const rent = parseInt(String(item.priceText).replace(/[^0-9]/g, ''), 10) || 0;
          if (!rent || !item.addressText) continue;
          const ref = admin.firestore().collection('listings').doc();
          batch.set(ref, {
            address: item.addressText,
            city: '',
            state: 'MA',
            zipCode: '',
            neighborhood: '',
            school: cfg.school,
            rent,
            rentPerPerson: rent,
            securityDeposit: 0,
            brokerFee: 0,
            bedrooms: 1,
            bathrooms: 1,
            squareFeet: 0,
            furnished: false,
            availableDate: '',
            leaseLength: 12,
            photos: [],
            virtualTour: '',
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
            source: 'zillow-scraped',
            verified: false,
            active: true,
            viewCount: 0,
            savedCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            coordinates: { lat: cfg.lat, lng: cfg.lng },
            distanceToSchool: 0
          });
        }
        await batch.commit();
      }
    } catch (e) {
      console.error('scrapeZillowNearSchool', e);
    } finally {
      if (browser) await browser.close();
    }
    return null;
  });

/**
 * SendGrid: notify on new inquiry (triggered when doc created in inquiries).
 */
exports.onNewInquiryEmail = functions.firestore
  .document('inquiries/{inquiryId}')
  .onCreate(async (snap) => {
    if (!SENDGRID_KEY) {
      console.info('SendGrid not configured; skipping email.');
      return null;
    }
    const data = snap.data();
    const landlordId = data.landlordId;
    if (!landlordId) return null;
    const userDoc = await admin.firestore().collection('users').doc(landlordId).get();
    const email = userDoc.exists ? userDoc.data().email : null;
    if (!email) return null;

    const msg = {
      to: email,
      from: FROM_EMAIL,
      subject: `New DormDrop inquiry: ${data.listingId || 'listing'}`,
      text: `You have a new inquiry from ${data.studentName || 'a student'}.\n\n${data.message || ''}\n\nReply to: ${data.studentEmail || ''}`
    };
    await sgMail.send(msg);
    return null;
  });
