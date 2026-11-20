export function t(key, ...subs) {
  return chrome.i18n.getMessage(key, subs.map(String)) || key;
}

export function uiLocale() {
  return chrome.i18n.getUILanguage();
}

export function localizePage(root = document) {
  document.documentElement.lang = uiLocale();
  document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
}
