/* Visitor analytics via Plausible (https://plausible.io): cookie-free and anonymous.
 * Only page views and a few product events (e.g. "Chat Opened" with the file type) are sent.
 * Chat contents, names and files never leave the device.
 *
 * To enable: copy the script URL from Plausible → Site settings → Site installation
 * and paste it below. It looks like https://plausible.io/js/pa-XXXXXXXXXXXX.js
 * (older accounts get https://plausible.io/js/script.js, which also works). */
(function () {
  'use strict';

  var PLAUSIBLE_SCRIPT = 'https://plausible.io/js/pa-q5IY-brEnYUMU8jljCp20.js';
  var SITE_DOMAIN = 'codeabraggs.github.io'; // only used by the older script.js snippet

  // Queue events until the script loads (or forever, harmlessly, if analytics is off).
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  window.plausible.init = window.plausible.init || function (o) { window.plausible.o = o || {}; };

  if (!PLAUSIBLE_SCRIPT || !/^https?:$/.test(location.protocol)) return;

  var s = document.createElement('script');
  s.async = true;
  s.src = PLAUSIBLE_SCRIPT;
  if (/\/script(\.[\w.-]+)?\.js$/.test(PLAUSIBLE_SCRIPT)) s.setAttribute('data-domain', SITE_DOMAIN);
  else window.plausible.init();
  document.head.appendChild(s);
})();
