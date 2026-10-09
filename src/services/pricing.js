const settingsDb = require('../db/settings');
const couponsDb = require('../db/coupons');
const subscriptionsDb = require('../db/subscriptions');
const adminsDb = require('../db/admins');

// Admins see the plan's test price so they can try the whole flow cheaply.
// Test prices never get extra discounts (keeps test runs predictable).
function baseFor(plan, userId) {
  if (adminsDb.isAdmin(userId) && plan.testPrice !== undefined && plan.testPrice !== null) {
    return { base: plan.testPrice, isTest: true };
  }
  return { base: plan.price, isTest: false };
}

// One place that decides what a user pays, used by the plan screen, the
// confirm screen, the actual purchase, and the auto-renew job - so they can
// never disagree.
//
//   quote(plan, userId, couponCode?) -> {
//     base, renewPct, renewOff, coupon, couponOff, couponError, final, isRenewal, isTest
//   }
function quote(plan, userId, couponCode = null) {
  const { base, isTest } = baseFor(plan, userId);
  const settings = settingsDb.load();

  let renewOff = 0;
  let isRenewal = false;
  const renewPct = Number(settings.renewDiscountPct) || 0;
  if (!isTest && !plan.oncePerUser && renewPct > 0 && subscriptionsDb.hasHadPlan(userId, plan.id)) {
    isRenewal = true;
    renewOff = Math.min(base, Math.floor(base * renewPct / 100));
  }

  let coupon = null;
  let couponOff = 0;
  let couponError = null;
  if (couponCode && !isTest) {
    const v = couponsDb.validate(couponCode, userId, plan.id);
    if (v.ok) {
      coupon = v.coupon;
      couponOff = couponsDb.discountFor(coupon, base - renewOff);
    } else {
      couponError = v.reason;
    }
  }

  const final = Math.max(0, base - renewOff - couponOff);
  return { base, isTest, isRenewal, renewPct, renewOff, coupon, couponOff, couponError, final };
}

// Price the auto-renew job charges (renewal discount applies, no coupon).
function renewalPrice(plan, userId) {
  return quote(plan, userId, null).final;
}

module.exports = { quote, renewalPrice, baseFor };
