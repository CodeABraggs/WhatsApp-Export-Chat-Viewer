/* Apply the saved theme before first paint (loaded synchronously in <head>) to avoid a flash. */
try {
  var savedTheme = localStorage.getItem('cev-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
} catch (e) { /* storage unavailable */ }
