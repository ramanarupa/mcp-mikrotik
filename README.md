# MCP MikroTik Server

MCP сервер для конфигурирования MikroTik RouterOS 7 через Claude Code. Позволяет управлять роутером напрямую из Claude Code, используя RouterOS API.

## Возможности

- Получение информации о системе и ресурсах
- Управление сетевыми интерфейсами
- Настройка IP адресов и маршрутов
- Конфигурация firewall правил и NAT
- Управление DHCP сервером и lease
- Настройка DNS
- Управление беспроводными интерфейсами
- Работа с пользователями и скриптами
- Создание backup и export конфигурации
- Выполнение произвольных RouterOS команд

## Требования

- Node.js 18 или выше
- MikroTik роутер с RouterOS 7
- Включенный API на MikroTik (по умолчанию порт 8728)

## Установка

```bash
npm install
npm run build
```

## Настройка MikroTik

1. Подключитесь к MikroTik через Winbox или SSH
2. Убедитесь, что API включен:
   ```
   /ip service print
   ```
   API должен быть enabled на порту 8728

3. Если API выключен, включите его:
   ```
   /ip service enable api
   ```

4. Создайте пользователя для API (рекомендуется):
   ```
   /user add name=api-user password=your-password group=full
   ```

## Настройка в Claude Code

### Быстрый старт (локальная конфигурация)

1. Скопируйте пример конфигурации:
   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. Отредактируйте `.mcp.json` и укажите данные вашего роутера:
   ```json
   {
     "mcpServers": {
       "mikrotik": {
         "command": "node",
         "args": ["./build/index.js"],
         "env": {
           "MIKROTIK_HOST": "192.168.88.1",
           "MIKROTIK_USER": "admin",
           "MIKROTIK_PASSWORD": "your-password",
           "MIKROTIK_PORT": "8728"
         }
       }
     }
   }
   ```

### Глобальная конфигурация

Альтернативно, добавьте MCP сервер в глобальную конфигурацию Claude Code:

**Windows:** `%USERPROFILE%\.claude-code\mcp_settings.json`
**Linux/macOS:** `~/.claude-code/mcp_settings.json`

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp-microtik\\build\\index.js"],
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USER": "admin",
        "MIKROTIK_PASSWORD": "your-password",
        "MIKROTIK_PORT": "8728"
      }
    }
  }
}
```

**Подробная инструкция:** См. [SETUP.md](SETUP.md) для детальных инструкций по настройке.

**Параметры:**
- `MIKROTIK_HOST` - IP адрес вашего MikroTik роутера
- `MIKROTIK_USER` - имя пользователя для API
- `MIKROTIK_PASSWORD` - пароль
- `MIKROTIK_PORT` - порт API (обычно 8728, для SSL - 8729)

## Использование

После настройки вы можете использовать MCP сервер в Claude Code. Примеры команд:

### Получить информацию о системе
```
Покажи информацию о системе MikroTik
```

### Посмотреть интерфейсы
```
Покажи все сетевые интерфейсы
```

### Добавить IP адрес
```
Добавь IP адрес 192.168.1.1/24 на интерфейс ether1
```

### Настроить firewall
```
Добавь правило firewall: разрешить SSH (порт 22) из подсети 192.168.88.0/24
```

### Посмотреть DHCP lease
```
Покажи все DHCP lease
```

### Создать backup
```
Создай backup конфигурации
```

## Доступные инструменты

- `mikrotik_system_info` - Информация о системе
- `mikrotik_get_interfaces` - Список интерфейсов
- `mikrotik_get_ip_addresses` - Список IP адресов
- `mikrotik_add_ip_address` - Добавить IP адрес
- `mikrotik_get_firewall_rules` - Список firewall правил
- `mikrotik_add_firewall_rule` - Добавить firewall правило
- `mikrotik_get_dhcp_leases` - DHCP lease
- `mikrotik_execute_command` - Выполнить RouterOS команду

## Безопасность

- Не храните пароли в открытом виде в конфигурации
- Используйте отдельного пользователя для API доступа
- Ограничьте доступ к API по IP адресам:
  ```
  /ip service set api address=192.168.88.0/24
  ```
- Рекомендуется использовать API-SSL (порт 8729) для шифрованного соединения

## Разработка

Запустить в режиме разработки:
```bash
npm run dev
```

Собрать проект:
```bash
npm run build
```

## Лицензия

MIT
