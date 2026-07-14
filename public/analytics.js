/* DormDrop — Google Analytics 4
   ─────────────────────────────────────────────────────────────
   The GA4 Measurement ID lives HERE and nowhere else.
   To point the whole site at a different GA4 property, change
   GA_MEASUREMENT_ID below — one spot, sitewide.

   Every page loads this file in <head>:  <script src="/analytics.js"></script>

   Fire custom events anywhere with:  ddTrack('event_name', { param: value })
*/
(function () {
  var GA_MEASUREMENT_ID = 'G-QJDY1PF349';

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  // Load the gtag.js library
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
  document.head.appendChild(s);

  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);

  // Central custom-event helper. Analytics must never break the page.
  window.ddTrack = function (name, params) {
    try { gtag('event', name, params || {}); }
    catch (e) { /* no-op */ }
  };

  // Expose the ID for anything that needs it
  window.DD_GA_ID = GA_MEASUREMENT_ID;
})();
