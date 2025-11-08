# MCP Server Setup for Claude Code CLI

This guide will help you set up an MCP server for managing MikroTik RouterOS through Claude Code CLI.

## Prerequisites

1. Node.js 18 or higher installed
2. Claude Code CLI installed
3. MikroTik router with RouterOS 7
4. API access to MikroTik

## Step 1: Configure MikroTik RouterOS

### Enable API

1. Connect to MikroTik via Winbox, SSH, or WebFig
2. Check the API service status:
   ```
   /ip service print
   ```

3. If API is disabled, enable it:
   ```
   /ip service enable api
   ```

4. (Optional) Restrict API access by IP:
   ```
   /ip service set api address=192.168.88.0/24
   ```

### Create an API User

It is recommended to create a separate user for API access:

```
/user add name=mcp-user password=strong-password group=full
```

Or for limited access, create a group with the necessary permissions:

```
/user group add name=mcp-group policy=read,write,policy,test
/user add name=mcp-user password=strong-password group=mcp-group
```

## Step 2: Build the MCP Server

If you haven't built the project yet:

```bash
cd E:\OpenWRT\mcp-microtik
npm install
npm run build
```

Verify that files appeared in the `build/` folder:

```bash
ls build/
```

You should see files: `index.js`, `mikrotik.js`, and others.

## Step 3: Configure Claude Code CLI

There are two ways to configure the MCP server: local (recommended) and global.

### Method 1: Local Configuration (Recommended)

Local configuration is stored in the project folder and is used only for this project.

1. Copy the example configuration:
   ```bash
   cp .mcp.json.example .mcp.json
   # Or on Windows
   copy .mcp.json.example .mcp.json
   ```

2. Edit the `.mcp.json` file in the project root:
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

**Advantages:**
- Configuration next to code
- Easy to switch between different routers
- Relative file paths
- Can be versioned (without passwords, using .gitignore)

### Method 2: Global Configuration

Global configuration is accessible from any directory.

**Configuration file location:**

**Windows:**
```
%USERPROFILE%\.claude-code\mcp_settings.json
```

**Linux/macOS:**
```
~/.claude-code/mcp_settings.json
```

**Adding configuration:**

1. Open the `mcp_settings.json` file in a text editor
2. Add or modify the `mcpServers` section:

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

**Important:** On Windows, use double backslashes `\\` in paths.

### Environment Variables Configuration

Replace the values with yours:

- `MIKROTIK_HOST` - IP address of your MikroTik router
- `MIKROTIK_USER` - username for API access
- `MIKROTIK_PASSWORD` - password
- `MIKROTIK_PORT` - API port (usually 8728, for SSL - 8729)

### Example for Linux/macOS

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

## Step 4: Verify Connection

### Restart Claude Code

After changing the configuration, restart Claude Code CLI:

```bash
# Close the current session and restart
claude-code
```

### Test the MCP Server

Try running a simple command:

```
Show MikroTik system information
```

Or:

```
Get a list of all network interfaces on the router
```

If everything is configured correctly, Claude Code should use the MCP server to execute the request.

## Usage Examples

### View Configuration

```
Show all IP addresses on MikroTik
```

```
Show firewall rules for input chain
```

```
Show all DHCP leases
```

### Add Configuration

```
Add IP address 192.168.10.1/24 to interface ether2
```

```
Add firewall rule: allow TCP port 22 from 192.168.88.0/24 with comment "SSH access"
```

```
Add static route 10.0.0.0/8 via gateway 192.168.88.254
```

### System Management

```
Create MikroTik configuration backup
```

```
Show list of users
```

```
Execute command /system/resource/print on the router
```

## Troubleshooting

### MCP Server Not Connecting

1. Verify that API is enabled on MikroTik:
   ```
   /ip service print
   ```

2. Check router accessibility:
   ```bash
   ping 192.168.88.1
   telnet 192.168.88.1 8728
   ```

3. Verify credentials are correct

4. Check Claude Code logs for errors

### "command not found" Error

Ensure the path to `index.js` is correct and the file exists:

```bash
# Windows
dir E:\OpenWRT\mcp-microtik\build\index.js

# Linux/macOS
ls -la /path/to/mcp-microtik/build/index.js
```

### API Connection Error

1. Check firewall on the router:
   ```
   /ip firewall filter print where chain=input
   ```

2. Ensure port 8728 is not blocked

3. Try connecting with another client (e.g., Winbox)

### Node.js Not Found

Ensure Node.js is installed and available in PATH:

```bash
node --version
```

If Node.js is not found, specify the full path in the configuration:

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

## Security

### Recommendations

1. **Do not store passwords in plain text**: Consider using system environment variables
2. **Restrict user permissions**: Create a group with minimal necessary permissions
3. **Restrict access by IP**: Use `/ip service set api address=...`
4. **Use SSL**: For production environments, use API-SSL (port 8729)

### API-SSL Configuration

1. Enable API-SSL on MikroTik:
   ```
   /ip service enable api-ssl
   ```

2. Modify the configuration:
   ```json
   {
     "env": {
       "MIKROTIK_HOST": "192.168.88.1",
       "MIKROTIK_PORT": "8729",
       ...
     }
   }
   ```

## Additional Information

### Available Tools

- `mikrotik_system_info` - System information
- `mikrotik_get_interfaces` - List interfaces
- `mikrotik_get_ip_addresses` - List IP addresses
- `mikrotik_add_ip_address` - Add IP address
- `mikrotik_get_firewall_rules` - List firewall rules
- `mikrotik_add_firewall_rule` - Add firewall rule
- `mikrotik_get_dhcp_leases` - DHCP leases
- `mikrotik_execute_command` - Execute arbitrary command

### Logs and Debugging

For debugging, you can add the `NODE_ENV` environment variable:

```json
{
  "env": {
    "NODE_ENV": "development",
    ...
  }
}
```

## Support

If you encounter issues:

1. Check README.md for additional information
2. Ensure all prerequisites are met
3. Check Claude Code and MikroTik logs
4. Create an issue in the project repository

## Updating

To update the MCP server:

```bash
cd E:\OpenWRT\mcp-microtik
git pull  # if using git
npm install
npm run build
```

After updating, restart Claude Code.
