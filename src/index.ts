#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MikroTikClient } from './mikrotik.js';

// MikroTik connection configuration from environment variables
const MIKROTIK_HOST = process.env.MIKROTIK_HOST || '';
const MIKROTIK_USER = process.env.MIKROTIK_USER || 'admin';
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD || '';
const MIKROTIK_PORT = parseInt(process.env.MIKROTIK_PORT || '8728', 10);

// Validate required environment variables
if (!MIKROTIK_HOST) {
  console.error('Error: MIKROTIK_HOST environment variable is required');
  process.exit(1);
}
if (!MIKROTIK_PASSWORD) {
  console.error('Error: MIKROTIK_PASSWORD environment variable is required');
  process.exit(1);
}

// Initialize MikroTik client
const mikrotikClient = new MikroTikClient(
  MIKROTIK_HOST,
  MIKROTIK_USER,
  MIKROTIK_PASSWORD,
  MIKROTIK_PORT
);

// Helper to return JSON result
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

// Define available tools
const tools: Tool[] = [
  // --- System ---
  {
    name: 'mikrotik_system_info',
    description: 'Get MikroTik system information (version, board, uptime, etc.)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_get_system_identity',
    description: 'Get MikroTik router identity (name)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_set_system_identity',
    description: 'Set MikroTik router identity (name)',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'New router identity name',
        },
      },
      required: ['name'],
    },
  },
  // --- Interfaces ---
  {
    name: 'mikrotik_get_interfaces',
    description: 'List all network interfaces on the MikroTik router',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_enable_interface',
    description: 'Enable a network interface',
    inputSchema: {
      type: 'object',
      properties: {
        interface: {
          type: 'string',
          description: 'Interface name (e.g., ether1)',
        },
      },
      required: ['interface'],
    },
  },
  {
    name: 'mikrotik_disable_interface',
    description: 'Disable a network interface',
    inputSchema: {
      type: 'object',
      properties: {
        interface: {
          type: 'string',
          description: 'Interface name (e.g., ether1)',
        },
      },
      required: ['interface'],
    },
  },
  // --- IP Addresses ---
  {
    name: 'mikrotik_get_ip_addresses',
    description: 'List all IP addresses configured on the MikroTik router',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_add_ip_address',
    description: 'Add an IP address to an interface',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'IP address with CIDR notation (e.g., 192.168.1.1/24)',
        },
        interface: {
          type: 'string',
          description: 'Interface name (e.g., ether1)',
        },
      },
      required: ['address', 'interface'],
    },
  },
  {
    name: 'mikrotik_remove_ip_address',
    description: 'Remove an IP address by its .id (get IDs from mikrotik_get_ip_addresses)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The .id of the IP address entry to remove',
        },
      },
      required: ['id'],
    },
  },
  // --- Routes ---
  {
    name: 'mikrotik_get_routes',
    description: 'List all IP routes on the MikroTik router',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_add_route',
    description: 'Add a static IP route',
    inputSchema: {
      type: 'object',
      properties: {
        dstAddress: {
          type: 'string',
          description: 'Destination address with CIDR (e.g., 10.0.0.0/8)',
        },
        gateway: {
          type: 'string',
          description: 'Gateway address (e.g., 192.168.1.1)',
        },
        distance: {
          type: 'number',
          description: 'Administrative distance (optional)',
        },
      },
      required: ['dstAddress', 'gateway'],
    },
  },
  // --- Firewall Filter ---
  {
    name: 'mikrotik_get_firewall_rules',
    description: 'List firewall filter rules',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Filter by chain (input, forward, output)',
        },
      },
      required: [],
    },
  },
  {
    name: 'mikrotik_add_firewall_rule',
    description: 'Add a new firewall filter rule',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Chain name (input, forward, output)',
        },
        action: {
          type: 'string',
          description: 'Action (accept, drop, reject)',
        },
        protocol: {
          type: 'string',
          description: 'Protocol (tcp, udp, icmp, etc.)',
        },
        srcAddress: {
          type: 'string',
          description: 'Source address (optional)',
        },
        dstAddress: {
          type: 'string',
          description: 'Destination address (optional)',
        },
        dstPort: {
          type: 'string',
          description: 'Destination port (optional)',
        },
        comment: {
          type: 'string',
          description: 'Comment for the rule (optional)',
        },
      },
      required: ['chain', 'action'],
    },
  },
  {
    name: 'mikrotik_remove_firewall_rule',
    description: 'Remove a firewall filter rule by its .id (get IDs from mikrotik_get_firewall_rules)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The .id of the firewall rule to remove',
        },
      },
      required: ['id'],
    },
  },
  // --- Firewall NAT ---
  {
    name: 'mikrotik_get_firewall_nat',
    description: 'List firewall NAT rules',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_add_firewall_nat',
    description: 'Add a new firewall NAT rule',
    inputSchema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Chain name (srcnat, dstnat)',
        },
        action: {
          type: 'string',
          description: 'Action (masquerade, dst-nat, src-nat, etc.)',
        },
        srcAddress: {
          type: 'string',
          description: 'Source address (optional)',
        },
        dstAddress: {
          type: 'string',
          description: 'Destination address (optional)',
        },
        toAddresses: {
          type: 'string',
          description: 'To addresses for NAT (optional)',
        },
        toPorts: {
          type: 'string',
          description: 'To ports for NAT (optional)',
        },
        protocol: {
          type: 'string',
          description: 'Protocol (tcp, udp, etc.)',
        },
        dstPort: {
          type: 'string',
          description: 'Destination port (optional)',
        },
        outInterface: {
          type: 'string',
          description: 'Out interface (optional)',
        },
        comment: {
          type: 'string',
          description: 'Comment for the rule (optional)',
        },
      },
      required: ['chain', 'action'],
    },
  },
  // --- DHCP ---
  {
    name: 'mikrotik_get_dhcp_leases',
    description: 'Get DHCP server leases',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  // --- DNS ---
  {
    name: 'mikrotik_get_dns_settings',
    description: 'Get DNS server settings',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
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
          description: 'List of DNS server addresses (e.g., ["8.8.8.8", "1.1.1.1"])',
        },
      },
      required: ['servers'],
    },
  },
  // --- Users ---
  {
    name: 'mikrotik_get_users',
    description: 'List router users',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  // --- Backup ---
  {
    name: 'mikrotik_create_backup',
    description: 'Create a router backup file',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Backup file name (optional, auto-generated if omitted)',
        },
      },
      required: [],
    },
  },
  // --- Generic command ---
  {
    name: 'mikrotik_execute_command',
    description:
      'Execute a custom RouterOS command. WARNING: Can run any command including destructive operations (/system/reboot, /system/reset-configuration, /file/remove). Use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'RouterOS command path (e.g., /interface/print)',
        },
        params: {
          type: 'object',
          description: 'Command parameters as key-value pairs (optional)',
        },
      },
      required: ['command'],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: 'mcp-mikrotik',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // --- System ---
      case 'mikrotik_system_info':
        return jsonResult(await mikrotikClient.getSystemInfo());

      case 'mikrotik_get_system_identity':
        return jsonResult(await mikrotikClient.getSystemIdentity());

      case 'mikrotik_set_system_identity': {
        const { name: identityName } = args as { name: string };
        return jsonResult(await mikrotikClient.setSystemIdentity(identityName));
      }

      // --- Interfaces ---
      case 'mikrotik_get_interfaces':
        return jsonResult(await mikrotikClient.getInterfaces());

      case 'mikrotik_enable_interface': {
        const { interface: iface } = args as { interface: string };
        await mikrotikClient.enableInterface(iface);
        return jsonResult({ status: 'success', interface: iface, action: 'enabled' });
      }

      case 'mikrotik_disable_interface': {
        const { interface: iface } = args as { interface: string };
        await mikrotikClient.disableInterface(iface);
        return jsonResult({ status: 'success', interface: iface, action: 'disabled' });
      }

      // --- IP Addresses ---
      case 'mikrotik_get_ip_addresses':
        return jsonResult(await mikrotikClient.getIpAddresses());

      case 'mikrotik_add_ip_address': {
        const { address, interface: iface } = args as {
          address: string;
          interface: string;
        };
        const result = await mikrotikClient.addIpAddress(address, iface);
        return jsonResult(result);
      }

      case 'mikrotik_remove_ip_address': {
        const { id } = args as { id: string };
        const result = await mikrotikClient.removeIpAddress(id);
        return jsonResult(result);
      }

      // --- Routes ---
      case 'mikrotik_get_routes':
        return jsonResult(await mikrotikClient.getRoutes());

      case 'mikrotik_add_route': {
        const { dstAddress, gateway, distance } = args as {
          dstAddress: string;
          gateway: string;
          distance?: number;
        };
        const result = await mikrotikClient.addRoute(dstAddress, gateway, distance);
        return jsonResult(result);
      }

      // --- Firewall Filter ---
      case 'mikrotik_get_firewall_rules': {
        const { chain } = args as { chain?: string };
        return jsonResult(await mikrotikClient.getFirewallRules(chain));
      }

      case 'mikrotik_add_firewall_rule': {
        const params = args as {
          chain: string;
          action: string;
          protocol?: string;
          srcAddress?: string;
          dstAddress?: string;
          dstPort?: string;
          comment?: string;
        };
        const result = await mikrotikClient.addFirewallRule(params);
        return jsonResult(result);
      }

      case 'mikrotik_remove_firewall_rule': {
        const { id } = args as { id: string };
        const result = await mikrotikClient.removeFirewallRule(id);
        return jsonResult(result);
      }

      // --- Firewall NAT ---
      case 'mikrotik_get_firewall_nat':
        return jsonResult(await mikrotikClient.getFirewallNat());

      case 'mikrotik_add_firewall_nat': {
        const params = args as {
          chain: string;
          action: string;
          srcAddress?: string;
          dstAddress?: string;
          toAddresses?: string;
          toPorts?: string;
          protocol?: string;
          dstPort?: string;
          outInterface?: string;
          comment?: string;
        };
        const result = await mikrotikClient.addFirewallNat(params);
        return jsonResult(result);
      }

      // --- DHCP ---
      case 'mikrotik_get_dhcp_leases':
        return jsonResult(await mikrotikClient.getDhcpLeases());

      // --- DNS ---
      case 'mikrotik_get_dns_settings':
        return jsonResult(await mikrotikClient.getDnsSettings());

      case 'mikrotik_set_dns_servers': {
        const { servers } = args as { servers: string[] };
        const result = await mikrotikClient.setDnsServers(servers);
        return jsonResult(result);
      }

      // --- Users ---
      case 'mikrotik_get_users':
        return jsonResult(await mikrotikClient.getUsers());

      // --- Backup ---
      case 'mikrotik_create_backup': {
        const { name: backupName } = args as { name?: string };
        const result = await mikrotikClient.createBackup(backupName);
        return jsonResult(result);
      }

      // --- Generic command ---
      case 'mikrotik_execute_command': {
        const { command, params } = args as {
          command: string;
          params?: Record<string, string | number>;
        };
        const result = await mikrotikClient.executeCommand(command, params);
        return jsonResult(result);
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MikroTik MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
