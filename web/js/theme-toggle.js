// Dark is the site's default look; light is an opt-in, remembered per-visitor.
// See the inline head script in index.html for the pre-paint half of this.

const STORAGE_KEY = 'theme';
const toggleButton = document.getElementById('theme-toggle');

function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing / storage disabled — theme just won't persist across visits.
  }
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    toggleButton.textContent = '☀️';
    toggleButton.setAttribute('aria-label', 'Switch to dark theme');
  } else {
    document.documentElement.removeAttribute('data-theme');
    toggleButton.textContent = '🌙';
    toggleButton.setAttribute('aria-label', 'Switch to light theme');
  }
}

applyTheme(readStoredTheme() === 'light' ? 'light' : 'dark');

toggleButton.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  storeTheme(next);
});
