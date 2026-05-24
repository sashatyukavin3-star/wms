/**
 * ESLint 9 flat config для клиента.
 *
 * Принципы:
 *  - Базовая строгость TypeScript (recommended, без typeChecked — иначе медленно).
 *  - React-hooks правила.
 *  - Автосортировка и автоудаление импортов (simple-import-sort + unused-imports).
 *  - Сознательно отключаем правила, которые в этом проекте дают много шума без пользы.
 *
 * Запуск:
 *   npm run lint        — проверка
 *   npm run lint:fix    — автоисправление того, что можно
 */
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'server/**',
      'public/sw.js', // Service Worker — другое окружение (ServiceWorkerGlobalScope)
      'scripts/**', // node-скрипты, проверяются отдельно
      'logo-preview.html',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      // React Hooks — стандартные правила
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Импорты — автосортировка
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      'unused-imports/no-unused-imports': 'warn',

      // TypeScript: any — предупреждение (есть техдолг, постепенно убираем)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Сознательно отключённые правила:
      // — non-null assertion: используется осознанно с Dexie/Drizzle типами
      '@typescript-eslint/no-non-null-assertion': 'off',
      // — пустые catch блоки: иногда нужны (обёртка для best-effort операций)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // — короткие тернары для side-effect (часто в onChange чекбоксов).
      //   Когда уберём такие места при рефакторинге — включим обратно.
      '@typescript-eslint/no-unused-expressions': [
        'warn',
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
  // Тесты — более мягкие правила
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Конфиг-файлы вне src — node-окружение
  {
    files: ['*.config.{js,ts}', '*.config.cjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  }
);
