// frontend/src/test/setup.ts
/// <reference types="vitest/globals" /> // ✅ إضافة مرجع النوع لتعريف vi

import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// ============================================================
// تمديد توقعات Vitest بمطابقات Jest DOM
// ============================================================

expect.extend(matchers);

// ============================================================
// تنظيف DOM بعد كل اختبار
// ============================================================

afterEach(() => {
  cleanup();
});

// ============================================================
// محاكاة (Mock) المتغيرات البيئية
// ============================================================

// ✅ استخدام vi بأمان (vi متوفر الآن بفضل مرجع النوع)
vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
vi.stubEnv('VITE_WS_URL', 'ws://localhost:3000/ws');
vi.stubEnv('VITE_PORT', '5173');

// ============================================================
// محاكاة (Mock) واجهات برمجة التطبيقات (APIs) غير المتوفرة في jsdom
// ============================================================

// محاكاة `matchMedia` (مطلوبة لـ `useMediaQuery`)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// محاكاة `IntersectionObserver`
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

// محاكاة `ResizeObserver`
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

// ============================================================
// محاكاة (Mock) localStorage
// ============================================================

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    length: 0,
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(window, 'localStorage', {
  writable: true,
  value: localStorageMock,
});

// ============================================================
// محاكاة (Mock) sessionStorage
// ============================================================

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    length: 0,
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  writable: true,
  value: sessionStorageMock,
});

// ============================================================
// محاكاة (Mock) fetch (اختياري)
// ============================================================

// global.fetch = vi.fn();

// ============================================================
// إعدادات إضافية لـ Vitest (اختيارية)
// ============================================================

// vi.spyOn(console, 'log').mockImplementation(() => {});
// vi.spyOn(console, 'debug').mockImplementation(() => {});
// vi.spyOn(console, 'info').mockImplementation(() => {});
// vi.spyOn(console, 'error').mockImplementation(() => {});
// vi.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================
// تصدير المحاكيات للاستخدام في الاختبارات
// ============================================================

export { localStorageMock, sessionStorageMock };