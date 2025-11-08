# MCP MikroTik Server

MCP server for configuring MikroTik RouterOS 7 through Claude Code. Allows you to manage the router directly from Claude Code using the RouterOS API.

## Features

- Get system and resource information
- Manage network interfaces
- Configure IP addresses and routes
- Configure firewall rules and NAT
- Manage DHCP server and leases
- Configure DNS
- Manage wireless interfaces
- Work with users and scripts
- Create backups and export configuration
- Execute arbitrary RouterOS commands

## Requirements

- Node.js 18 or higher
- MikroTik router with RouterOS 7
- Enabled API on MikroTik (default port 8728)

## Installation

```bash
npm install
npm run build
```

## MikroTik Configuration

1. Connect to MikroTik via Winbox or SSH
2. Ensure API is enabled:
   ```
   /ip service print
   ```
   API should be enabled on port 8728

3. If API is disabled, enable it:
   ```
   /ip service enable api
   ```

4. Create an API user (recommended):
   ```
   /user add name=api-user password=your-password group=full
   ```

## Claude Code Setup

### Quick Start (Local Configuration)

1. Copy the example configuration:
   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. Edit `.mcp.json` and specify your router details:
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

### Global Configuration

Alternatively, add the MCP server to Claude Code's global configuration:

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

**Detailed Instructions:** See [SETUP.md](SETUP.md) for detailed setup instructions.

**Parameters:**
- `MIKROTIK_HOST` - IP address of your MikroTik router
- `MIKROTIK_USER` - username for API access
- `MIKROTIK_PASSWORD` - password
- `MIKROTIK_PORT` - API port (usually 8728, for SSL - 8729)

## Usage

After setup, you can use the MCP server in Claude Code. Example commands:

### Get system information
```
Show MikroTik system information
```

### View interfaces
```
Show all network interfaces
```

### Add IP address
```
Add IP address 192.168.1.1/24 to interface ether1
```

### Configure firewall
```
Add firewall rule: allow SSH (port 22) from subnet 192.168.88.0/24
```

### View DHCP leases
```
Show all DHCP leases
```

### Create backup
```
Create configuration backup
```

## Available Tools

- `mikrotik_system_info` - System information
- `mikrotik_get_interfaces` - List interfaces
- `mikrotik_get_ip_addresses` - List IP addresses
- `mikrotik_add_ip_address` - Add IP address
- `mikrotik_get_firewall_rules` - List firewall rules
- `mikrotik_add_firewall_rule` - Add firewall rule
- `mikrotik_get_dhcp_leases` - DHCP leases
- `mikrotik_execute_command` - Execute RouterOS command

## Security

- Do not store passwords in plain text in configuration files
- Use a separate user for API access
- Restrict API access by IP addresses:
  ```
  /ip service set api address=192.168.88.0/24
  ```
- It is recommended to use API-SSL (port 8729) for encrypted connections

## Development

Run in development mode:
```bash
npm run dev
```

Build the project:
```bash
npm run build
```

## License

MIT
