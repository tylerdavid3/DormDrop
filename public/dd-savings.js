/* DormDrop — canonical savings model (single source of truth).
   Every marketing savings figure on the site is computed HERE so it can never
   drift from the on-page calculator. Mirrors the calculator's DEFAULT selections.

   Comparison = HOUSING + FOOD + UTILITIES only. Tuition is excluded (identical
   either way) and general financial aid is NOT subtracted. Default summer
   setting is "I go home", i.e. a 9-month academic-year basis.

   To change a figure sitewide, edit CFG below — nothing else. */
(function () {
  var GROC = 300, UTIL = 100, MONTHS = 9; // groceries + utilities per person / month; go-home basis

  // room + meal = each school's DEFAULT (first) calculator option.
  // rent = the calculator's default off-campus rent estimate, per person / month.
  var CFG = {
    bu:        { room: 13170, meal: 7570, rent: 1200 },
    neu:       { room: 10270, meal: 8900, rent: 1200 },
    merrimack: { room: 13324, meal: 8610, rent: 900  },
    curry:     { room: 11180, meal: 9510, rent: 900  }
  };

  var DD = {};
  Object.keys(CFG).forEach(function (slug) {
    var c = CFG[slug];
    var on  = c.room + c.meal;              // 9-month room & board
    var off = (c.rent + GROC + UTIL) * MONTHS;
    DD[slug] = {
      onCampus: on,
      offCampus: off,
      savings: Math.max(0, Math.round((on - off) / 10) * 10) // nearest $10, matches calculator
    };
  });
  window.DD_SAVINGS = DD;

  function money(n) { return '$' + n.toLocaleString(); }

  // Populate any element with a data-dd="<kind>:<slug>" attribute.
  function fill() {
    document.querySelectorAll('[data-dd]').forEach(function (el) {
      var p = el.getAttribute('data-dd').split(':'), kind = p[0], d = DD[p[1]];
      if (!d) return;
      if (kind === 'savings')        el.textContent = money(d.savings);
      else if (kind === 'oncampus')  el.textContent = money(d.onCampus) + ' / yr';
      else if (kind === 'offcampus') el.textContent = money(d.offCampus) + ' / yr';
      else if (kind === 'offbar')    el.style.width = Math.round(d.offCampus / d.onCampus * 100) + '%';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();
})();
