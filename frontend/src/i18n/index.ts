import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

const STORED_LANG_KEY = 'rocket-leaf:lang'

function readInitialLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return 'zh'
  const stored = window.localStorage.getItem(STORED_LANG_KEY)
  if (stored === 'zh' || stored === 'en') return stored
  return 'zh'
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: readInitialLanguage(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  returnNull: false,
})

export function setLanguage(lang: SupportedLanguage) {
  if (i18n.language === lang) return
  void i18n.changeLanguage(lang)
  try {
    window.localStorage.setItem(STORED_LANG_KEY, lang)
  } catch {
    // localStorage may be unavailable; ignore
  }
}

export default i18n
