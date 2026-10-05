/* App version shown in the footer. Keep in sync with package.json (a test checks).
   The deploy workflow replaces 'dev' with the short commit hash. */
(function (root) {
  root.SNOREWATCH_VERSION = { version: '1.20.0', build: 'dev' };
  if (typeof module === 'object' && module.exports) module.exports = root.SNOREWATCH_VERSION;
})(typeof self !== 'undefined' ? self : this);
