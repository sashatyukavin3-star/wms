# Storra WMS — ready workspace

Воркспейс подготовлен к запуску без лишних сервисов.

## Что уже настроено

- `server/.env` создан
- integration token уже задан: `invent_alex20_den26`
- backend + frontend готовы к запуску
- включены модули: ASN, QC inbound, packing, replenishment, returns

## Логин по умолчанию

- `admin`
- `admin123`

## Самый быстрый запуск на Windows

```bat
start-all.bat
```

Он поднимет:
- backend (`3000`)
- frontend (`5173`)

## Куда заходить

- WMS: `http://localhost:5173`
- backend health: `http://localhost:3000/api/health`

## Что должно быть видно в меню

- ASN / Поставки
- Пополнение
- Возвраты
- Заказы
- Инвентаризация
- Аналитика
- Акты

## Что уже внедрено

- ASN / ожидаемые поставки
- план-факт inbound
- QC / discrepancy handling
- richer cell model (pick/putaway priorities, picking face, mixed SKU)
- packing layer
- replenishment layer
- return / reverse flow

## Что ещё уже встроено

- Глобальный поиск по товарам, ASN, возвратам, заказам, ячейкам и актам
- ASN / поставки
- QC inbound
- Packing layer
- Replenishment layer
- Returns / reverse flow

- Cycle Count / адресный пересчёт
