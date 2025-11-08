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
const MIKROTIK_PORT = parseInt(process.env.MIKROTIK_PORT || '8728');

// Initialize MikroTik client
const mikrotikClient = new MikroTikClient(
  MIKROTIK_HOST,
  MIKROTIK_USER,
  MIKROTIK_PASSWORD,
  MIKROTIK_PORT
);

// Define available tools
const tools: Tool[] = [
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
    name: 'mikrotik_get_interfaces',
    description: 'List all network interfaces on the MikroTik router',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
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
    name: 'mikrotik_get_dhcp_leases',
    description: 'Get DHCP server leases',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'mikrotik_execute_command',
    description: 'Execute a custom RouterOS command',
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
      case 'mikrotik_system_info': {
        const result = await mikrotikClient.getSystemInfo();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'mikrotik_get_interfaces': {
        const result = await mikrotikClient.getInterfaces();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'mikrotik_get_ip_addresses': {
        const result = await mikrotikClient.getIpAddresses();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'mikrotik_add_ip_address': {
        const { address, interface: iface } = args as {
          address: string;
          interface: string;
        };
        const result = await mikrotikClient.addIpAddress(address, iface);
        return {
          content: [
            {
              type: 'text',
              text: `IP address ${address} added to ${iface}: ${result}`,
            },
          ],
        };
      }

      case 'mikrotik_get_firewall_rules': {
        const { chain } = args as { chain?: string };
        const result = await mikrotikClient.getFirewallRules(chain);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
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
        return {
          content: [
            {
              type: 'text',
              text: `Firewall rule added: ${result}`,
            },
          ],
        };
      }

      case 'mikrotik_get_dhcp_leases': {
        const result = await mikrotikClient.getDhcpLeases();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'mikrotik_execute_command': {
        const { command, params } = args as {
          command: string;
          params?: Record<string, any>;
        };
        const result = await mikrotikClient.executeCommand(command, params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
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
