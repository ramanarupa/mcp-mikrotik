# Настройка MCP сервера для Claude Code CLI

Это руководство поможет настроить MCP сервер для управления MikroTik RouterOS через Claude Code CLI.

## Предварительные требования

1. Установлен Node.js 18 или выше
2. Установлен Claude Code CLI
3. MikroTik роутер с RouterOS 7
4. Доступ к MikroTik через API

## Шаг 1: Настройка MikroTik RouterOS

### Включение API

1. Подключитесь к MikroTik через Winbox, SSH или WebFig
2. Проверьте статус API сервиса:
   ```
   /ip service print
   ```

3. Если API выключен, включите его:
   ```
   /ip service enable api
   ```

4. (Опционально) Ограничьте доступ к API по IP:
   ```
   /ip service set api address=192.168.88.0/24
   ```

### Создание пользователя для API

Рекомендуется создать отдельного пользователя для API доступа:

```
/user add name=mcp-user password=strong-password group=full
```

Или для ограниченного доступа создайте группу с нужными правами:

```
/user group add name=mcp-group policy=read,write,policy,test
/user add name=mcp-user password=strong-password group=mcp-group
```

## Шаг 2: Сборка MCP сервера

Если вы ещё не собрали проект:

```bash
cd E:\OpenWRT\mcp-microtik
npm install
npm run build
```

Проверьте, что файлы появились в папке `build/`:

```bash
ls build/
```

Должны быть файлы: `index.js`, `mikrotik.js` и другие.

## Шаг 3: Настройка Claude Code CLI

Есть два способа настройки MCP сервера: локальный (рекомендуется) и глобальный.

### Способ 1: Локальная конфигурация (рекомендуется)

Локальная конфигурация хранится в папке проекта и используется только для этого проекта.

1. Скопируйте пример конфигурации:
   ```bash
   cp .mcp.json.example .mcp.json
   # Или на Windows
   copy .mcp.json.example .mcp.json
   ```

2. Отредактируйте файл `.mcp.json` в корне проекта:
   ```json
   {
     "mcpServers": {
       "mikrotik": {
         "command": "node",
         "args": ["./build/index.js"],
         "env": {
           "MIKROTIK_HOST": "192.168.88.1",
           "MIKROTIK_USER": "mcp-user",
           "MIKROTIK_PASSWORD": "strong-password",
           "MIKROTIK_PORT": "8728"
         },
         "disabled": false
       }
     }
   }
   ```

**Преимущества:**
- Конфигурация рядом с кодом
- Легко переключаться между разными роутерами
- Относительные пути к файлам
- Можно версионировать (без паролей, используя .gitignore)

### Способ 2: Глобальная конфигурация

Глобальная конфигурация доступна из любой директории.

**Расположение конфигурационного файла:**

**Windows:**
```
%USERPROFILE%\.claude-code\mcp_settings.json
```

**Linux/macOS:**
```
~/.claude-code/mcp_settings.json
```

**Добавление конфигурации:**

1. Откройте файл `mcp_settings.json` в текстовом редакторе
2. Добавьте или измените секцию `mcpServers`:

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp-microtik\\build\\index.js"],
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USER": "mcp-user",
        "MIKROTIK_PASSWORD": "strong-password",
        "MIKROTIK_PORT": "8728"
      },
      "disabled": false
    }
  }
}
```

**Важно:** На Windows используйте двойные обратные слеши `\\` в путях.

### Настройка переменных окружения

Замените значения на ваши:

- `MIKROTIK_HOST` - IP адрес вашего MikroTik роутера
- `MIKROTIK_USER` - имя пользователя для API
- `MIKROTIK_PASSWORD` - пароль
- `MIKROTIK_PORT` - порт API (обычно 8728, для SSL - 8729)

### Пример для Linux/macOS

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["/home/user/mcp-microtik/build/index.js"],
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USER": "mcp-user",
        "MIKROTIK_PASSWORD": "strong-password",
        "MIKROTIK_PORT": "8728"
      }
    }
  }
}
```

## Шаг 4: Проверка подключения

### Перезапуск Claude Code

После изменения конфигурации перезапустите Claude Code CLI:

```bash
# Закройте текущую сессию и запустите заново
claude-code
```

### Тестирование MCP сервера

Попробуйте выполнить простую команду:

```
Покажи информацию о системе MikroTik
```

Или:

```
Получи список всех сетевых интерфейсов на роутере
```

Если всё настроено правильно, Claude Code должен использовать MCP сервер для выполнения запроса.

## Примеры использования

### Просмотр конфигурации

```
Покажи все IP адреса на MikroTik
```

```
Покажи firewall правила для chain input
```

```
Покажи все DHCP lease
```

### Добавление конфигурации

```
Добавь IP адрес 192.168.10.1/24 на интерфейс ether2
```

```
Добавь firewall правило: разрешить TCP порт 22 из 192.168.88.0/24 с комментарием "SSH access"
```

```
Добавь статический маршрут 10.0.0.0/8 через gateway 192.168.88.254
```

### Управление системой

```
Создай backup конфигурации MikroTik
```

```
Покажи список пользователей
```

```
Выполни команду /system/resource/print на роутере
```

## Устранение проблем

### MCP сервер не подключается

1. Проверьте, что API включен на MikroTik:
   ```
   /ip service print
   ```

2. Проверьте доступность роутера:
   ```bash
   ping 192.168.88.1
   telnet 192.168.88.1 8728
   ```

3. Проверьте правильность учётных данных

4. Проверьте логи Claude Code для ошибок

### Ошибка "command not found"

Убедитесь, что путь к `index.js` правильный и файл существует:

```bash
# Windows
dir E:\OpenWRT\mcp-microtik\build\index.js

# Linux/macOS
ls -la /path/to/mcp-microtik/build/index.js
```

### Ошибка подключения к API

1. Проверьте firewall на роутере:
   ```
   /ip firewall filter print where chain=input
   ```

2. Убедитесь, что порт 8728 не заблокирован

3. Попробуйте подключиться с другого клиента (например, Winbox)

### Node.js не найден

Убедитесь, что Node.js установлен и доступен в PATH:

```bash
node --version
```

Если Node.js не найден, укажите полный путь в конфигурации:

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["E:\\OpenWRT\\mcp-microtik\\build\\index.js"],
      ...
    }
  }
}
```

## Безопасность

### Рекомендации

1. **Не храните пароли в открытом виде**: Рассмотрите использование переменных окружения системы
2. **Ограничьте права пользователя**: Создайте группу с минимально необходимыми правами
3. **Ограничьте доступ по IP**: Используйте `/ip service set api address=...`
4. **Используйте SSL**: Для продакшн окружения используйте API-SSL (порт 8729)

### Настройка API-SSL

1. Включите API-SSL на MikroTik:
   ```
   /ip service enable api-ssl
   ```

2. Измените конфигурацию:
   ```json
   {
     "env": {
       "MIKROTIK_HOST": "192.168.88.1",
       "MIKROTIK_PORT": "8729",
       ...
     }
   }
   ```

## Дополнительная информация

### Доступные инструменты

- `mikrotik_system_info` - Информация о системе
- `mikrotik_get_interfaces` - Список интерфейсов
- `mikrotik_get_ip_addresses` - Список IP адресов
- `mikrotik_add_ip_address` - Добавить IP адрес
- `mikrotik_get_firewall_rules` - Список firewall правил
- `mikrotik_add_firewall_rule` - Добавить firewall правило
- `mikrotik_get_dhcp_leases` - DHCP lease
- `mikrotik_execute_command` - Выполнить произвольную команду

### Логи и отладка

Для отладки можно добавить переменную окружения `NODE_ENV`:

```json
{
  "env": {
    "NODE_ENV": "development",
    ...
  }
}
```

## Поддержка

Если у вас возникли проблемы:

1. Проверьте README.md для дополнительной информации
2. Убедитесь, что все предварительные требования выполнены
3. Проверьте логи Claude Code и MikroTik
4. Создайте issue в репозитории проекта

## Обновление

Для обновления MCP сервера:

```bash
cd E:\OpenWRT\mcp-microtik
git pull  # если используете git
npm install
npm run build
```

После обновления перезапустите Claude Code.
