# 🚀 Установка Storra WMS на другой компьютер

Есть **4 способа** запустить Storra WMS на новой машине — выбирай по сценарию.

## 📋 Быстрый выбор

| Сценарий | Способ | Время |
|---|---|---|
| Просто открыть и попользоваться | [Способ 1: один HTML-файл](#способ-1--один-html-файл-самое-простое) | 1 мин |
| Регулярно работать с интернета | [Способ 2: GitHub Pages](#способ-2--github-pages-бесплатный-хостинг) | 10 мин |
| Свой склад в локальной сети | [Способ 3: локальный сервер](#способ-3--локальный-сервер-в-сети-склада) | 20 мин |
| Разработка и доработки | [Способ 4: исходники + npm](#способ-4--исходники--npm-для-разработки) | 15 мин |

---

## 🟢 Способ 1 — Один HTML-файл (самое простое)

**Когда подходит:** хочется быстро открыть приложение, нет интернета или прав на установку.

### Что нужно
- Любой современный браузер (Chrome, Edge, Firefox, Safari, Yandex)
- USB-флешка / email / мессенджер для передачи файла

### Шаги
1. На своём ПК собрать проект:
   ```bash
   cd storra-wms
   npm install
   npm run build
   ```
2. Взять файл `dist/index.html` (~830 КБ, всё внутри: код, стили, иконки)
3. Скопировать на флешку и перенести на новый ПК
4. Открыть файл двойным кликом — он откроется в браузере

### ⚠️ Что не будет работать через `file://`
- **Service Worker** (но он и не нужен — оффлайн всё равно работает через IndexedDB)
- **Камера** (через `file://` браузеры блокируют доступ)
- **PWA-установка** на главный экран

Для всех остальных задач — приёмка, отгрузка, акты, печать стикеров — этого достаточно.

### 💡 Лучше: открыть через простой локальный сервер
Если на новом ПК есть Python:
```bash
# Положи index.html в любую папку и запусти:
python -m http.server 8080
# Теперь открой http://localhost:8080 в браузере → камера и PWA работают
```

---

## 🌐 Способ 2 — GitHub Pages (бесплатный хостинг)

**Когда подходит:** хочешь, чтобы Storra WMS была доступна с любого ПК по адресу `https://твой-логин.github.io/storra-wms/`.

### Шаги

1. Залей свой репозиторий на GitHub (у тебя уже есть `wmss`)

2. В корне проекта создай файл `.github/workflows/deploy.yml`:
   ```yaml
   name: Deploy to GitHub Pages
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     deploy:
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: npm ci
         - run: npm run build
         - uses: actions/configure-pages@v4
         - uses: actions/upload-pages-artifact@v3
           with: { path: ./dist }
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

3. В настройках репозитория: **Settings → Pages → Source: GitHub Actions**

4. Запушь изменения — через 2 минуты сайт развернётся
5. Открывай с любого ПК: `https://твой-логин.github.io/storra-wms/`

### ✅ Бонусы
- HTTPS включён автоматически → камера и PWA работают
- На телефоне «Добавить на экран Домой» → ярлык приложения
- Service Worker → работает оффлайн

### ⚠️ Важно
- **Данные привязаны к браузеру каждого устройства** — у админа и кладовщика будут разные базы! Это всё ещё WMS-без-бэкенда.
- Для синхронизации между устройствами нужна **Фаза 4: бэкенд** (Supabase / свой сервер).

---

## 🏢 Способ 3 — Локальный сервер в сети склада

**Когда подходит:** у тебя есть один ПК на складе, и все ТСД должны заходить с него.

### Вариант A: nginx (быстро и надёжно)

1. На «серверной» машине: установи [nginx](https://nginx.org/ru/download.html)
2. Положи `dist/` в `/var/www/storra-wms/` (Linux) или `C:\nginx\html\storra-wms\` (Windows)
3. В `nginx.conf`:
   ```nginx
   server {
       listen 80;
       server_name storra.local;
       root /var/www/storra-wms;
       index index.html;
       location / { try_files $uri /index.html; }
   }
   ```
4. Перезапусти nginx
5. На каждом ТСД/планшете открывай `http://IP-сервера/`

### Вариант B: serve (за 30 секунд)

Если на серверной машине есть Node.js:
```bash
npm install -g serve
cd storra-wms/dist
serve -p 80 -s .
```
Готово — сервер на порту 80, все устройства в сети открывают по IP.

### ⚠️ Те же ограничения
Данные всё ещё в IndexedDB **каждого устройства**. Сервер только раздаёт HTML.

---

## 💻 Способ 4 — Исходники + npm (для разработки)

**Когда подходит:** хочешь дорабатывать код, делать правки, видеть hot-reload.

### Что нужно
- **Node.js 20+** ([скачать](https://nodejs.org))
- **Git** ([скачать](https://git-scm.com))

### Шаги

```bash
# 1. Клонировать репозиторий
git clone https://github.com/sashatyukavin3-star/wmss.git
cd wmss

# 2. Установить зависимости
npm install

# 3. Запустить dev-сервер
npm run dev
# → откроется http://localhost:5173 с hot-reload

# 4. Собрать prod-версию
npm run build
# → dist/index.html — single-file, можно деплоить
```

### Доступные команды

| Команда | Что делает |
|---|---|
| `npm run dev` | Dev-сервер с hot-reload на http://localhost:5173 |
| `npm run build` | Production-сборка → `dist/index.html` (single-file) |
| `npm run preview` | Локально посмотреть собранный билд |
| `npm run typecheck` | Проверить типы TypeScript |
| `npm run lint` | Проверить код ESLint |
| `npm run lint:fix` | Исправить, что можно, автоматически |
| `npm run format` | Привести код к единому стилю (Prettier) |

### Запуск dev-сервера на другом ПК в сети

Если хочешь, чтобы коллега зашёл на твой dev-сервер по IP:

```bash
npm run dev -- --host 0.0.0.0
```
Vite напечатает что-то вроде:
```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.42:5173/
```
Коллега открывает `Network`-адрес со своего устройства.

---

## 📦 Что в репозитории должно быть

Минимальный набор файлов для запуска на новом ПК:
```
storra-wms/
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                    ← весь код приложения
├── public/                 ← манифест, иконки, sw.js
├── README.md
└── INSTALL.md              ← этот файл
```

Что **НЕ нужно** копировать (всё пересоздастся `npm install`):
- `node_modules/` (200+ МБ зависимостей)
- `dist/` (генерируется `npm run build`)

---

## 🆘 Частые проблемы

### «`npm` не найден»
Установи Node.js: https://nodejs.org → перезапусти терминал.

### «Permission denied» на Linux/macOS
```bash
sudo npm install -g serve   # для Способа 3 варианта B
```

### Сайт открывается, но пустая страница
Проверь консоль браузера (F12). Скорее всего проблема со Service Worker — открой `chrome://serviceworker-internals/` и удали все registrations для домена.

### Камера/PWA не работают
Они требуют **HTTPS** или **localhost**. Через `file://` или `http://` (кроме localhost) браузеры их блокируют. Используй Способ 2 (GitHub Pages = HTTPS) или поставь HTTPS-сертификат на свой сервер (`certbot` для nginx).

### Старые данные после обновления
Storra хранит данные в IndexedDB. После большого обновления (изменение схемы БД) старая база может конфликтовать. Решение:
1. Открой DevTools (F12)
2. Application → IndexedDB → `NexusWMS_Pro` → Delete database
3. Перезагрузи страницу

⚠️ Перед удалением — сделай **Бэкап** через раздел «Настройки»!

---

## 🔐 Безопасность при размещении в сети

- Смени пароль `admin/admin123` сразу после первого входа
- Создай по отдельному пользователю каждому кладовщику
- Для прода — обязательно HTTPS (GitHub Pages даёт его бесплатно)
- Аудит-журнал в Настройках покажет кто что делал

---

## 📞 Что дальше?

Когда будешь готов:
- Многопользовательский режим с реальной синхронизацией → нужен бэкенд (Supabase / Node + PostgreSQL)
- Интеграция с 1С → REST-эндпоинт обмена JSON
- Сертификат HTTPS для своего домена → Let's Encrypt + nginx

Удачи на складе! 📦
