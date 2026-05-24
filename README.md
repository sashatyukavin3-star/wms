# 📦 Storra WMS

> **Offline-first система управления складом (WMS)** для одного рабочего места или ТСД. Работает полностью в браузере: всё хранение — IndexedDB через Dexie, сборка — single-file HTML.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React 19](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite 7](https://img.shields.io/badge/Vite-7-purple?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-cyan?logo=tailwindcss)](https://tailwindcss.com/)
[![Dexie 4](https://img.shields.io/badge/Dexie-4-green)](https://dexie.org/)

![Storra WMS Dashboard](https://via.placeholder.com/1200x400/4F46E5/FFFFFF?text=Storra+WMS+-+Warehouse+Management+System)

---

## 🌟 Возможности

### 📦 Управление запасами
- Справочники товаров и ячеек с импортом/экспортом CSV
- Приёмка с партиями и сроками годности
- Инвентаризация с сессиями и применением корректировок
- Cycle Count / адресный пересчёт по кандидатам риска

### ⬇️ Inbound (Входящий поток)
- ASN / ожидаемые поставки с план-фактом
- QC и обработка брака/расхождений
- Статусы документа: `draft` → `arrived` → `receiving` → `completed` / `cancelled`

### ⬆️ Outbound (Исходящий поток)
- Отгрузка с FIFO-подбором
- Автоматическое обновление статусов заказа
- Packing-этап перед отгрузкой (`picked` → `packed` → `shipped`)

### 🔄 Операции на складе
- Перемещение между ячейками
- Возвраты с обработкой: `restock` / `quarantine` / `scrap`
- Пополнение picking-face с автоматическими suggestions

### 📊 Аналитика и отчёты
- Дашборд с KPI и графиками
- ABC/XYZ-аналитика
- Глобальный поиск по всем сущностям

### 🖨️ Печать и документы
- Печатные стикеры Code 128 (ISO/IEC 15417)
- Акты осмотра ячеек и переработки

### 🔐 Безопасность
- Локальная авторизация с ролями (`operator` / `supervisor` / `admin`)
- PBKDF2-SHA256 хэширование (210 000 итераций, индивидуальная соль)
- Транзакционные операции Dexie для целостности данных

---

## 🚀 Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск дев-сервера
npm run dev

# Сборка single-file HTML
npm run build

# Предпросмотр сборки
npm run preview
```

### 📜 Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск Vite dev-сервера |
| `npm run build` | Сборка production-версии |
| `npm run preview` | Preview собранной версии |
| `npm run typecheck` | Проверка типов TypeScript |
| `npm run lint` | ESLint проверка |
| `npm run format` | Prettier форматирование |

---

## 🏗️ Архитектура

```
src/
├── App.tsx              # Роутинг, авторизация, тосты
├── db.ts                # Dexie модели, атомарные операции
├── main.tsx             # Точка входа
├── index.css            # Tailwind v4 + дизайн-токены
├── utils.ts             # CSV, Code 128, утилиты
├── utils/cn.ts          # clsx + tailwind-merge
├── hooks/
│   └── useData.tsx      # DataProvider (кэш товаров/ячеек)
└── pages/
    ├── Dashboard.tsx    # KPI, графики, дефицит
    ├── Products.tsx     # Каталог товаров
    ├── Cells.tsx        # Ячейки хранения
    ├── Asn.tsx          # Ожидаемые поставки
    ├── Receive.tsx      # Приёмка товара
    ├── Ship.tsx         # Отгрузка
    ├── Move.tsx         # Перемещения
    ├── Inventory.tsx    # Инвентаризация
    ├── Replenishment.tsx # Пополнение picking-face
    ├── Returns.tsx      # Возвраты
    ├── Orders.tsx       # Заказы / packing
    ├── Analytics.tsx    # ABC/XYZ анализ
    ├── Acts.tsx         # Акты осмотра/переработки
    ├── Stickers.tsx     # Печать стикеров
    └── SettingsPage.tsx # Настройки системы
```

---

## 🛠️ Технологический стек

| Категория | Технологии |
|-----------|------------|
| **Frontend** | React 19, TypeScript 5.9 (strict) |
| **Build** | Vite 7 |
| **Styling** | Tailwind CSS 4 |
| **Database** | Dexie 4 (IndexedDB wrapper) |
| **Charts** | Chart.js + react-chartjs-2 |
| **Icons** | lucide-react |
| **Testing** | Vitest |
| **Linting** | ESLint + Prettier |

---

## ⚠️ Важные ограничения

> **Внимание:** это **клиентский WMS**. Все данные хранятся в IndexedDB браузера на одном устройстве.

### 🔴 Фундаментальные ограничения

- ❌ Нет синхронизации между устройствами/операторами
- ❌ Очистка кэша браузера = потеря данных
- ❌ Авторизация защищает интерфейс, но не данные
- ✅ Регулярно делайте **бэкапы** через раздел «Настройки»

Для серьёзного многопользовательского сценария нужен серверный backend.

---

## 🔐 Безопасность

### Авторизация
- **Хэширование:** PBKDF2-SHA256, 210 000 итераций
- **Соль:** 16-байтовая per-user
- **Сравнение:** за постоянное время (защита от тайминг-атак)
- **Миграция:** старые пароли автоматически обновляются

### Дефолтные учётные данные
```
Логин: admin
Пароль: admin123
```
> ⚠️ **Обязательно смените пароль при первом входе!**

### Транзакции
Все складские операции (`receive`, `ship`, `move`) выполняются в транзакциях Dexie — гарантия атомарности.

---

## 📚 Документация

- [📥 Установка и настройка](INSTALL.md)
- [⚡ Быстрый старт](QUICKSTART.md)
- [🤝 Вклад в проект](CONTRIBUTING.md)
- [📋 История изменений](CHANGELOG.md)

---

## 🎯 Ключевые особенности из зрелых WMS/ERP систем

| Источник | Внедрённая функция |
|----------|-------------------|
| **GreaterWMS** | ASN / ожидаемые поставки с план-фактом |
| **OpenWMS** | Модель ячейки с `max_units`, `allow_mixed_sku`, приоритетами |
| **Зрелые ERP** | Packing-этап, статус `packed`, reverse flow (возвраты) |
| **Search-first UX** | Глобальный поиск по всем сущностям |
| **Cycle Count** | Выборочный пересчёт по кандидатам риска |

---

## 📄 Лицензия

Распространяется под лицензией **MIT**. См. файл [LICENSE](LICENSE) для деталей.

---

## 🤝 Поддержка

- 📧 Email: support@storra-wms.local
- 🐛 Issues: [GitHub Issues](https://github.com/your-org/storra-wms/issues)
- 📖 Wiki: [Документация](https://github.com/your-org/storra-wms/wiki)

---

<div align="center">

**Storra WMS** — Простое управление складом в вашем браузере 🚀

Made with ❤️ using React + TypeScript + Vite

</div>
