import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ensureApiClientInitialized } from './services/api.client';

// ✅ تهيئة عميل API بعد تحميل جميع الوحدات (ضمان جاهزية المتجر)
ensureApiClientInitialized();

/**
 * تهيئة وبدء تشغيل تطبيق React.
 * [مُتحقَّق منطقياً بتتبع كامل] — نقطة الدخول الرئيسية مع دعم StrictMode.
 */
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('❌ عنصر root غير موجود في HTML');
}

// تطبيق النمط المحفوظ (للمزامنة مع ui.store)
const applySavedTheme = () => {
  try {
    const savedTheme = localStorage.getItem('ui-theme-resolved');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  } catch {
    // تجاهل أخطاء localStorage
  }
};

applySavedTheme();

const root = ReactDOM.createRoot(rootElement);

if (import.meta.env.DEV) {
  console.log('🚀 بدء تشغيل تطبيق WhatsApp AI Agent - Frontend');
  console.log(`📦 البيئة: ${import.meta.env.MODE}`);
  console.log(`🔗 رابط API: ${import.meta.env.VITE_API_URL || 'http://localhost:3000'}`);
}

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export { root };