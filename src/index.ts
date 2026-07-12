#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MikroTikClient } from './mikrotik.js';

// ---- Configuration ----
const MIKROTIK_HOST = process.env.MIKROTIK_HOST || '';
const MIKROTIK_USER = process.env.MIKROTIK_USER || 'admin';
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD || '';
const MIKROTIK_TLS = /^(1|true|yes)$/i.test(process.env.MIKROTIK_TLS || '');
const MIKROTIK_TLS_REJECT_UNAUTHORIZED = /^(1|true|yes)$/i.test(
  process.env.MIKROTIK_TLS_REJECT_UNAUTHORIZED || '',
);
const MIKROTIK_ALLOW_DESTRUCTIVE = /^(1|true|yes)$/i.test(
  process.env.MIKROTIK_ALLOW_DESTRUCTIVE || '',
);

const portRaw = process.env.MIKROTIK_PORT;
let MIKROTIK_PORT: number | undefined;
if (portRaw && portRaw.length > 0) {
  const parsed = Number(portRaw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`Error: MIKROTIK_PORT must be an integer in 1..65535, got "${portRaw}"`);
    process.exit(1);
  }
  MIKROTIK_PORT = parsed;
}

const timeoutRaw = process.env.MIKROTIK_TIMEOUT;
let MIKROTIK_TIMEOUT: number | undefined;
if (timeoutRaw && timeoutRaw.length > 0) {
  const parsed = Number(timeoutRaw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 600) {
    console.error(`Error: MIKROTIK_TIMEOUT must be an integer in 1..600 (seconds), got "${timeoutRaw}"`);
    process.exit(1);
  }
  MIKROTIK_TIMEOUT = parsed;
}

if (!MIKROTIK_HOST) {
  console.error('Error: MIKROTIK_HOST environment variable is required');
  process.exit(1);
}
if (!MIKROTIK_PASSWORD) {
  console.error('Error: MIKROTIK_PASSWORD environment variable is required');
  process.exit(1);
}

const mikrotikClient = new MikroTikClient({
  host: MIKROTIK_HOST,
  user: MIKROTIK_USER,
  password: MIKROTIK_PASSWORD,
  port: MIKROTIK_PORT,
  tls: MIKROTIK_TLS,
  rejectUnauthorized: MIKROTIK_TLS_REJECT_UNAUTHORIZED,
  timeout: MIKROTIK_TIMEOUT,
});

// ---- Diagnostic markers ----
// Every marker goes to stderr; stdout is reserved for the MCP JSON-RPC stream.
// (Claude Code captures MCP server stderr in its logs.)
export const MARKER = '[MCP-MARKER]';
export function marker(...parts: unknown[]): void {
  console.error(MARKER, ...parts);
}

// node-routeros throws SYNCHRONOUSLY from inside the socket 'data' callback:
//   Channel.onUnknown()      -> RosException 'UNKNOWNREPLY'
//   Receiver.sendTagData()   -> RosException 'UNREGISTEREDTAG'
// Those throws are outside any promise, so execute()'s try/catch cannot see
// them. Without these handlers Node prints the stack and EXITS the process,
// which the MCP client reports as "Connection closed". We log the culprit
// (which throw + which command, correlate with the execute >> marker) and keep
// the process alive, dropping the now-orphaned RouterOS connection so the next
// tool call reconnects cleanly.
process.on('uncaughtException', (err) => {
  marker('uncaughtException:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  void mikrotikClient.close().catch(() => {});
});
process.on('unhandledRejection', (reason) => {
  marker(
    'unhandledRejection:',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
});

// ---- Result helpers ----
function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

// ---- Argument validation ----
function asObject(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) return {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Arguments must be an object');
  }
  return args as Record<string, unknown>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing or invalid required string parameter "${key}"`);
  }
  return v;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`Parameter "${key}" must be a string`);
  }
  return v;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Parameter "${key}" must be a finite number`);
  }
  return v;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') {
    throw new Error(`Parameter "${key}" must be a boolean`);
  }
  return v;
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new Error(`Parameter "${key}" must be an array of strings`);
  }
  return v as string[];
}

function optionalStringRecord(
  args: Record<string, unknown>,
  key: string,
): Record<string, string | number> | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`Parameter "${key}" must be an object`);
  }
  const result: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' || (typeof val === 'number' && Number.isFinite(val))) {
      result[k] = val as string | number;
    } else {
      throw new Error(`Parameter "${key}.${k}" must be a string or finite number`);
    }
  }
  return result;
}

// ---- Tool definitions ----
const tools: Tool[] = [
  // System
  {
    name: 'mikrotik_system_info',
    description: 'Get MikroTik system information (version, board, uptime, etc.)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_get_system_identity',
    description: 'Get MikroTik router identity (name)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_set_system_identity',
    description: 'Set MikroTik router identity (name)',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'New router identity name' } },
      required: ['name'],
    },
  },
  // Interfaces
  {
    name: 'mikrotik_get_interfaces',
    description: 'List all network interfaces on the MikroTik router',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_enable_interface',
    description: 'Enable a network interface by name (e.g., ether1) or .id',
    inputSchema: {
      type: 'object',
      properties: { interface: { type: 'string', description: 'Interface name or .id' } },
      required: ['interface'],
    },
  },
  {
    name: 'mikrotik_disable_interface',
    description: 'Disable a network interface by name (e.g., ether1) or .id',
    inputSchema: {
      type: 'object',
      properties: { interface: { type: 'string', description: 'Interface name or .id' } },
      required: ['interface'],
    },
  },
  // IP Addresses
  {
    name: 'mikrotik_get_ip_addresses',
    description: 'List all IP addresses configured on the MikroTik router',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_add_ip_address',
    description: 'Add an IP address to an interface',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'IP address with CIDR (e.g., 192.168.1.1/24)' },
        interface: { type: 'string', description: 'Interface name (e.g., ether1)' },
        network: { type: 'string', description: 'Network address (optional)' },
      },
      required: ['address', 'interface'],
    },
  },
  {
    name: 'mikrotik_remove_ip_address',
    description: 'Remove an IP address by its .id (get IDs from mikrotik_get_ip_addresses)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The .id of the IP address entry' } },
      required: ['id'],
    },
  },
  // Routes
  {
    name: 'mikrotik_get_routes',
    description: 'List all IP routes on the MikroTik router',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_add_route',
    description: 'Add a static IP route',
    inputSchema: {
      type: 'object',
      properties: {
        dstAddress: { type: 'string', description: 'Destination address with CIDR' },
        gateway: { type: 'string', description: 'Gateway address' },
        distance: { type: 'number', description: 'Administrative distance (optional)' },
      },
      required: ['dstAddress', 'gateway'],
    },
  },
  // Firewall Filter
  {
    name: 'mikrotik_get_firewall_rules',
    description: 'List firewall filter rules',
    inputSchema: {
      type: 'object',
      properties: { chain: { type: 'string', description: 'Filter by chain' } },
      required: [],
    },
  },
  {
    name: 'mikrotik_add_firewall_rule',
    description: 'Add a new firewall filter rule',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain name (input, forward, output)' },
        action: { type: 'string', description: 'Action (accept, drop, reject)' },
        protocol: { type: 'string', description: 'Protocol (tcp, udp, icmp, etc.)' },
        srcAddress: { type: 'string', description: 'Source address (optional)' },
        dstAddress: { type: 'string', description: 'Destination address (optional)' },
        srcPort: { type: 'string', description: 'Source port (optional)' },
        dstPort: { type: 'string', description: 'Destination port (optional)' },
        inInterface: { type: 'string', description: 'Input interface (optional)' },
        outInterface: { type: 'string', description: 'Output interface (optional)' },
        comment: { type: 'string', description: 'Comment (optional)' },
      },
      required: ['chain', 'action'],
    },
  },
  {
    name: 'mikrotik_remove_firewall_rule',
    description: 'Remove a firewall filter rule by its .id',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The .id of the firewall rule' } },
      required: ['id'],
    },
  },
  // Firewall NAT
  {
    name: 'mikrotik_get_firewall_nat',
    description: 'List firewall NAT rules',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_add_firewall_nat',
    description: 'Add a new firewall NAT rule',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Chain (srcnat, dstnat)' },
        action: { type: 'string', description: 'Action (masquerade, dst-nat, src-nat, etc.)' },
        srcAddress: { type: 'string' },
        dstAddress: { type: 'string' },
        toAddresses: { type: 'string' },
        toPorts: { type: 'string' },
        protocol: { type: 'string' },
        dstPort: { type: 'string' },
        outInterface: { type: 'string' },
        comment: { type: 'string' },
      },
      required: ['chain', 'action'],
    },
  },
  // DHCP
  {
    name: 'mikrotik_get_dhcp_servers',
    description: 'List DHCP servers',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_get_dhcp_leases',
    description: 'Get DHCP server leases',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_add_dhcp_lease',
    description: 'Add a static DHCP lease',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'IP address to assign' },
        macAddress: { type: 'string', description: 'Client MAC address' },
        server: { type: 'string', description: 'DHCP server name (optional)' },
        comment: { type: 'string', description: 'Comment (optional)' },
      },
      required: ['address', 'macAddress'],
    },
  },
  // DNS
  {
    name: 'mikrotik_get_dns_settings',
    description: 'Get DNS server settings',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_set_dns_servers',
    description: 'Set DNS servers',
    inputSchema: {
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of DNS servers (e.g., ["8.8.8.8", "1.1.1.1"])',
        },
      },
      required: ['servers'],
    },
  },
  {
    name: 'mikrotik_get_dns_cache',
    description: 'Get DNS cache entries',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // Wireless
  {
    name: 'mikrotik_get_wireless_interfaces',
    description: 'List wireless interfaces',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_get_wireless_registration_table',
    description: 'List wireless clients (registration table)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // Users
  {
    name: 'mikrotik_get_users',
    description: 'List router users',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_add_user',
    description: 'Add a router user',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User name' },
        password: { type: 'string', description: 'User password' },
        group: { type: 'string', description: 'Group name (default: full)' },
      },
      required: ['name', 'password'],
    },
  },
  // Scripts
  {
    name: 'mikrotik_get_scripts',
    description: 'List RouterOS scripts',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mikrotik_run_script',
    description: 'Run a RouterOS script by name or .id',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Script name or .id' } },
      required: ['name'],
    },
  },
  // Backup
  {
    name: 'mikrotik_create_backup',
    description: 'Create a router backup file',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Backup file name (optional)' } },
      required: [],
    },
  },
  {
    name: 'mikrotik_export_config',
    description: 'Export the full router configuration',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // Logs
  {
    name: 'mikrotik_search_logs',
    description:
      'Search the RouterOS system log (/log/print). Filter by "message" (case-insensitive substring, or a regex when regex=true) and/or by "topics" (comma-separated; an entry matches if its topics contain ANY given value as a substring, e.g. "wireguard" or "dhcp,error"). Returns matched entries newest-first, up to "limit" (default 100). With no filters, returns the most recent entries.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Match the log message: case-insensitive substring, or a regex when regex=true',
        },
        topics: {
          type: 'string',
          description: 'Comma-separated topics to match (substring, case-insensitive), e.g. "wireguard" or "dhcp,error"',
        },
        regex: {
          type: 'boolean',
          description: 'Treat "message" as a case-insensitive regular expression (default false)',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return, newest-first (default 100)',
        },
      },
      required: [],
    },
  },
  // Generic
  {
    name: 'mikrotik_execute_command',
    description:
      'Execute a custom RouterOS command. Destructive commands (/system/reboot, /system/reset-configuration, /file/remove, /user/remove, /system/shutdown) are blocked unless MIKROTIK_ALLOW_DESTRUCTIVE=true is set.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'RouterOS command path (e.g., /interface/print)' },
        params: { type: 'object', description: 'Command parameters as key-value pairs (optional)' },
      },
      required: ['command'],
    },
  },
];

const server = new Server(
  { name: 'mcp-mikrotik', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  try {
    const args = asObject(rawArgs);

    switch (name) {
      // System
      case 'mikrotik_system_info':
        return jsonResult(await mikrotikClient.getSystemInfo());
      case 'mikrotik_get_system_identity':
        return jsonResult(await mikrotikClient.getSystemIdentity());
      case 'mikrotik_set_system_identity':
        return jsonResult(await mikrotikClient.setSystemIdentity(requireString(args, 'name')));

      // Interfaces
      case 'mikrotik_get_interfaces':
        return jsonResult(await mikrotikClient.getInterfaces());
      case 'mikrotik_enable_interface': {
        const iface = requireString(args, 'interface');
        return jsonResult(await mikrotikClient.enableInterface(iface));
      }
      case 'mikrotik_disable_interface': {
        const iface = requireString(args, 'interface');
        return jsonResult(await mikrotikClient.disableInterface(iface));
      }

      // IP Addresses
      case 'mikrotik_get_ip_addresses':
        return jsonResult(await mikrotikClient.getIpAddresses());
      case 'mikrotik_add_ip_address':
        return jsonResult(
          await mikrotikClient.addIpAddress(
            requireString(args, 'address'),
            requireString(args, 'interface'),
            optionalString(args, 'network'),
          ),
        );
      case 'mikrotik_remove_ip_address':
        return jsonResult(await mikrotikClient.removeIpAddress(requireString(args, 'id')));

      // Routes
      case 'mikrotik_get_routes':
        return jsonResult(await mikrotikClient.getRoutes());
      case 'mikrotik_add_route':
        return jsonResult(
          await mikrotikClient.addRoute(
            requireString(args, 'dstAddress'),
            requireString(args, 'gateway'),
            optionalNumber(args, 'distance'),
          ),
        );

      // Firewall Filter
      case 'mikrotik_get_firewall_rules':
        return jsonResult(await mikrotikClient.getFirewallRules(optionalString(args, 'chain')));
      case 'mikrotik_add_firewall_rule':
        return jsonResult(
          await mikrotikClient.addFirewallRule({
            chain: requireString(args, 'chain'),
            action: requireString(args, 'action'),
            protocol: optionalString(args, 'protocol'),
            srcAddress: optionalString(args, 'srcAddress'),
            dstAddress: optionalString(args, 'dstAddress'),
            srcPort: optionalString(args, 'srcPort'),
            dstPort: optionalString(args, 'dstPort'),
            inInterface: optionalString(args, 'inInterface'),
            outInterface: optionalString(args, 'outInterface'),
            comment: optionalString(args, 'comment'),
          }),
        );
      case 'mikrotik_remove_firewall_rule':
        return jsonResult(await mikrotikClient.removeFirewallRule(requireString(args, 'id')));

      // Firewall NAT
      case 'mikrotik_get_firewall_nat':
        return jsonResult(await mikrotikClient.getFirewallNat());
      case 'mikrotik_add_firewall_nat':
        return jsonResult(
          await mikrotikClient.addFirewallNat({
            chain: requireString(args, 'chain'),
            action: requireString(args, 'action'),
            srcAddress: optionalString(args, 'srcAddress'),
            dstAddress: optionalString(args, 'dstAddress'),
            toAddresses: optionalString(args, 'toAddresses'),
            toPorts: optionalString(args, 'toPorts'),
            protocol: optionalString(args, 'protocol'),
            dstPort: optionalString(args, 'dstPort'),
            outInterface: optionalString(args, 'outInterface'),
            comment: optionalString(args, 'comment'),
          }),
        );

      // DHCP
      case 'mikrotik_get_dhcp_servers':
        return jsonResult(await mikrotikClient.getDhcpServers());
      case 'mikrotik_get_dhcp_leases':
        return jsonResult(await mikrotikClient.getDhcpLeases());
      case 'mikrotik_add_dhcp_lease':
        return jsonResult(
          await mikrotikClient.addDhcpLease({
            address: requireString(args, 'address'),
            macAddress: requireString(args, 'macAddress'),
            server: optionalString(args, 'server'),
            comment: optionalString(args, 'comment'),
          }),
        );

      // DNS
      case 'mikrotik_get_dns_settings':
        return jsonResult(await mikrotikClient.getDnsSettings());
      case 'mikrotik_set_dns_servers':
        return jsonResult(
          await mikrotikClient.setDnsServers(requireStringArray(args, 'servers')),
        );
      case 'mikrotik_get_dns_cache':
        return jsonResult(await mikrotikClient.getDnsCache());

      // Wireless
      case 'mikrotik_get_wireless_interfaces':
        return jsonResult(await mikrotikClient.getWirelessInterfaces());
      case 'mikrotik_get_wireless_registration_table':
        return jsonResult(await mikrotikClient.getWirelessRegistrationTable());

      // Users
      case 'mikrotik_get_users':
        return jsonResult(await mikrotikClient.getUsers());
      case 'mikrotik_add_user':
        return jsonResult(
          await mikrotikClient.addUser(
            requireString(args, 'name'),
            requireString(args, 'password'),
            optionalString(args, 'group') ?? 'full',
          ),
        );

      // Scripts
      case 'mikrotik_get_scripts':
        return jsonResult(await mikrotikClient.getScripts());
      case 'mikrotik_run_script':
        return jsonResult(await mikrotikClient.runScript(requireString(args, 'name')));

      // Backup
      case 'mikrotik_create_backup':
        return jsonResult(await mikrotikClient.createBackup(optionalString(args, 'name')));
      case 'mikrotik_export_config':
        return jsonResult(await mikrotikClient.exportConfig());

      // Logs
      case 'mikrotik_search_logs':
        return jsonResult(
          await mikrotikClient.searchLogs({
            message: optionalString(args, 'message'),
            topics: optionalString(args, 'topics'),
            regex: optionalBoolean(args, 'regex'),
            limit: optionalNumber(args, 'limit'),
          }),
        );

      // Generic
      case 'mikrotik_execute_command':
        return jsonResult(
          await mikrotikClient.executeCommand(
            requireString(args, 'command'),
            optionalStringRecord(args, 'params'),
            MIKROTIK_ALLOW_DESTRUCTIVE,
          ),
        );

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

async function shutdown() {
  try {
    await mikrotikClient.close();
  } catch {
    // ignore
  }
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `MikroTik MCP server running on stdio (host=${MIKROTIK_HOST}, tls=${MIKROTIK_TLS}, destructive=${MIKROTIK_ALLOW_DESTRUCTIVE}, timeout=${MIKROTIK_TIMEOUT ?? 30}s)`,
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
