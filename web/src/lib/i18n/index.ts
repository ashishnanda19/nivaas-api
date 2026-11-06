import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { hi } from './hi'
import { mr } from './mr'

type DeepStr<T> = { [K in keyof T]: T[K] extends string ? string : DeepStr<T[K]> }
export type Dict = DeepStr<typeof en>

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'mr', label: 'मराठी' },
] as const
export type Lang = (typeof LANGS)[number]['code']

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi }, mr: { translation: mr } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
