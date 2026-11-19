

## Ж.1 Каталог API

[ТАБЛИЦА]

**Таблица А.1 — Группы конечных точек**

| Группа | Маршруты | Доступ и назначение |
|---|---|---|
| Служебные и auth | GET /api/health; GET /api/auth/me; POST /api/auth/login, /register, /demo, /logout | Health публичен; login/register создают сессию; demo только development; logout отзывает текущую сессию |
| Снимок и профиль | GET /api/home; PATCH /api/profile | Доступный дом и связанные данные; изменение профиля и пароля с отзывом прочих сессий |
| Дом и комнаты | PATCH /api/homes/:id; POST /api/homes/:id/rooms; PATCH/DELETE /api/rooms/:id | Изменения разрешены owner соответствующего дома либо admin |
| Устройства | POST /api/homes/:id/devices; PATCH/DELETE /api/devices/:id | Создание состояния нужного класса, частичное изменение, удаление с учётом ссылок сценариев |
| Датчики | GET /api/devices/:id/readings; POST /api/devices/:id/simulate | Чтение истории членом дома; симуляция — owner/admin при включённом режиме |
| Сценарии | POST /api/homes/:id/scenes; PATCH/DELETE /api/scenes/:id; POST /api/scenes/:id/run | CRUD и атомарный запуск только для owner/admin |
| События | GET /api/homes/:id/events; GET /api/homes/:id/events/export | Поиск, тип, даты, страницы по 20 и безопасный CSV в пределах доступного дома |
| Admin | GET /api/admin; POST /api/admin/users/:id/password, /revoke; POST/PATCH/DELETE /api/admin/:resource | Только актуальная роль admin; фиксированный whitelist; секреты не возвращаются |

Все защищённые изменения требуют сессию и CSRF; все небезопасные методы проходят Origin/Sec-Fetch-Site guard.

## Ж.2 Каталог БД

[ТАБЛИЦА]

**Таблица Б.1 — Шестнадцать таблиц DOMA**

| Таблица | Назначение и основные ограничения |
|---|---|
| users | Учётные записи; email UNIQUE NOCASE; роль user/admin; scrypt-хеш; защита последнего admin |
| sessions | FK на users; уникальный token_hash, csrf_hash, срок; открытые секреты отсутствуют |
| homes | Приватные пространства с названием и адресом |
| home_members | Связь user—home, UNIQUE пары, owner/member; защита последнего owner |
| rooms | Комнаты дома, изображение, иконка и порядок |
| device_types | Каталог light/climate/sensor; sensor требует metric и unit |
| devices | Экземпляр в комнате, ссылка на тип, online 0/1 |
| light_states | Состояние light 1:1; power, brightness 0–100, color_temp 2000–6500 |
| climate_states | Состояние climate 1:1; power, температуры и mode |
| sensor_states | Текущее значение датчика 1:1 и updated_at |
| sensor_readings | История измерений с FK на устройство и временем |
| scenes | Сценарии дома, оформление и last_run |
| scene_actions | Действия; FK scene/device, property/value, UNIQUE сочетания |
| scene_schedules | Расписание 1:1; HH:MM, days_mask, enabled, last_run_minute |
| event_types | Справочник типа и severity; системные строки защищены |
| events | Журнал дома; ссылки на устройство/пользователя допускают SET NULL |

Схема использует foreign_keys, WAL, busy_timeout, шесть индексов и семь триггеров. Текущие состояния и исторические факты разделены; плоские DTO являются JOIN-проекциями.

## Ж.3 Матрица трассируемости

[ТАБЛИЦА]

**Таблица В.1 — Требование, реализация и проверка**

| Требование | Реализация | Проверка и статус |
|---|---|---|
| Регистрация, вход и приватный дом | Auth API, scrypt, sessions, home_members, транзакционное создание | Т-01, Т-02, Т-04, Т-05 — подтверждено |
| Комнаты, свет и климат | CRUD, классовые состояния, диапазоны Zod и CHECK | Т-06, Т-15 — подтверждено |
| Атомарные сценарии и расписания | scenes/actions/schedules, транзакции, days_mask, дедупликация | Т-07, Т-08, Т-19, Т-20 — подтверждено |
| Датчики и история | sensor_states/readings, метрические диапазоны, лимиты | Т-09, Т-17 — подтверждено |
| Журнал, поиск и CSV | Bind-параметры, фильтры, пагинация, formula escaping | Т-10 — подтверждено |
| Администрирование | Реестр 16 ресурсов, relation checks, специальные password/revoke | Т-11–Т-13, Т-17 — подтверждено |
| CSRF и источник | CSRF-header, SameSite, Origin, Sec-Fetch-Site | Т-03, Т-18 — подтверждено |
| Объектный и ролевой доступ | homeAccess, owner/member/admin, nested FK checks | Т-05, Т-14 — подтверждено |
| Целостность и миграции | FK, CHECK, UNIQUE, триггеры, транзакционные миграции | Т-15, Т-16, Т-20 — подтверждено |
| Безопасная production-конфигурация | Нет demo/default credentials, Secure-cookie, fail-safe паролей | Т-21, Т-22 — подтверждено |
| Типизация и сборка | TypeScript noEmit и Vite build | 19.11.2026 — подтверждено |
| Базовая связность UI/API | Реальный login, навигация, switch и range с клавиатуры | Функциональный прогон — частично подтверждено |
| Полная визуальная, браузерная и нагрузочная пригодность | Реализация имеется, специализированный полный цикл отсутствует | Требует дальнейшей проверки |
| HTTPS reverse proxy и Docker | Конфигурация предусмотрена, среда не испытана | Остаточное ограничение |
| Физические IoT-устройства | Не входят в границу программного симулятора | Не реализуются в текущем проекте |
