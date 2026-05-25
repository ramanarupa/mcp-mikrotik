import { RouterOSAPI } from 'node-routeros';

export type RouterOSResponse = Record<string, unknown>;

export interface MikroTikClientOptions {
  host: string;
  user: string;
  password: string;
  port?: number;
  tls?: boolean;
  rejectUnauthorized?: boolean;
  timeout?: number;
}

const DESTRUCTIVE_COMMANDS: ReadonlyArray<string> = [
  '/system/reset-configuration',
  '/system/reboot',
  '/system/shutdown',
  '/file/remove',
  '/user/remove',
];

export class MikroTikClient {
  private readonly options: Required<Omit<MikroTikClientOptions, 'tls' | 'rejectUnauthorized'>> & {
    tls: boolean;
    rejectUnauthorized: boolean;
  };
  private api: RouterOSAPI | null = null;
  private connectPromise: Promise<RouterOSAPI> | null = null;

  constructor(opts: MikroTikClientOptions) {
    this.options = {
      host: opts.host,
      user: opts.user,
      password: opts.password,
      port: opts.port ?? (opts.tls ? 8729 : 8728),
      tls: opts.tls ?? false,
      rejectUnauthorized: opts.rejectUnauthorized ?? false,
      timeout: opts.timeout ?? 10,
    };
  }

  private sanitizeValue(value: string | number): string {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid numeric parameter: ${value}`);
      }
      return value.toString();
    }
    if (typeof value !== 'string') {
      throw new Error(`Parameter must be string or number, got ${typeof value}`);
    }
    return value;
  }

  private paramsToArray(params?: Record<string, string | number>): string[] {
    if (!params) return [];
    return Object.entries(params).map(([key, value]) => `=${key}=${this.sanitizeValue(value)}`);
  }

  private async getConnection(): Promise<RouterOSAPI> {
    if (this.api && this.api.connected) {
      return this.api;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const api = new RouterOSAPI({
      host: this.options.host,
      user: this.options.user,
      password: this.options.password,
      port: this.options.port,
      timeout: this.options.timeout,
      keepalive: true,
      tls: this.options.tls
        ? { rejectUnauthorized: this.options.rejectUnauthorized }
        : undefined,
    });
    api.on('error', () => {
      // Surface in next call; drop cached connection.
      if (this.api === api) {
        this.api = null;
      }
    });
    this.connectPromise = api
      .connect()
      .then((connected) => {
        this.api = connected;
        this.connectPromise = null;
        return connected;
      })
      .catch((err) => {
        this.connectPromise = null;
        throw err;
      });
    return this.connectPromise;
  }

  async close(): Promise<void> {
    const api = this.api;
    this.api = null;
    if (api && api.connected) {
      try {
        await api.close();
      } catch {
        // ignore
      }
    }
  }

  async execute(
    command: string,
    params?: Record<string, string | number>,
  ): Promise<RouterOSResponse[]> {
    const paramArray = this.paramsToArray(params);
    let api: RouterOSAPI;
    try {
      api = await this.getConnection();
      return (await api.write(command, paramArray)) as RouterOSResponse[];
    } catch (err) {
      // Single retry on stale-connection class of errors.
      if (this.isConnectionError(err)) {
        this.api = null;
        api = await this.getConnection();
        return (await api.write(command, paramArray)) as RouterOSResponse[];
      }
      throw err;
    }
  }

  private isConnectionError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const msg = (err as { message?: string }).message ?? '';
    return (
      msg.includes('not connected') ||
      msg.includes('ECONNRESET') ||
      msg.includes('socket') ||
      msg.includes('EPIPE') ||
      msg.includes('closed')
    );
  }

  // ---- Helpers ----

  /** Resolve an interface name to its internal `.id` (e.g., "*1"). */
  private async resolveInterfaceId(nameOrId: string): Promise<string> {
    if (nameOrId.startsWith('*')) return nameOrId;
    const rows = (await this.execute('/interface/print', { name: nameOrId })) as Array<
      Record<string, unknown>
    >;
    if (!rows.length) {
      throw new Error(`Interface not found: ${nameOrId}`);
    }
    const id = rows[0]['.id'];
    if (typeof id !== 'string') {
      throw new Error(`Interface ${nameOrId} has no .id`);
    }
    return id;
  }

  /** Resolve a script name to its internal `.id`. */
  private async resolveScriptId(nameOrId: string): Promise<string> {
    if (nameOrId.startsWith('*')) return nameOrId;
    const rows = (await this.execute('/system/script/print', { name: nameOrId })) as Array<
      Record<string, unknown>
    >;
    if (!rows.length) {
      throw new Error(`Script not found: ${nameOrId}`);
    }
    const id = rows[0]['.id'];
    if (typeof id !== 'string') {
      throw new Error(`Script ${nameOrId} has no .id`);
    }
    return id;
  }

  // ---- System ----
  async getSystemInfo(): Promise<RouterOSResponse[]> {
    return this.execute('/system/resource/print');
  }

  async getSystemIdentity(): Promise<RouterOSResponse[]> {
    return this.execute('/system/identity/print');
  }

  async setSystemIdentity(name: string): Promise<RouterOSResponse[]> {
    return this.execute('/system/identity/set', { name });
  }

  // ---- Interfaces ----
  async getInterfaces(): Promise<RouterOSResponse[]> {
    return this.execute('/interface/print');
  }

  async enableInterface(interfaceName: string): Promise<RouterOSResponse[]> {
    const id = await this.resolveInterfaceId(interfaceName);
    return this.execute('/interface/enable', { '.id': id });
  }

  async disableInterface(interfaceName: string): Promise<RouterOSResponse[]> {
    const id = await this.resolveInterfaceId(interfaceName);
    return this.execute('/interface/disable', { '.id': id });
  }

  // ---- IP Addresses ----
  async getIpAddresses(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/address/print');
  }

  async addIpAddress(address: string, iface: string, network?: string): Promise<RouterOSResponse[]> {
    const params: Record<string, string> = { address, interface: iface };
    if (network) params.network = network;
    return this.execute('/ip/address/add', params);
  }

  async removeIpAddress(id: string): Promise<RouterOSResponse[]> {
    return this.execute('/ip/address/remove', { '.id': id });
  }

  // ---- Routes ----
  async getRoutes(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/route/print');
  }

  async addRoute(
    dstAddress: string,
    gateway: string,
    distance?: number,
  ): Promise<RouterOSResponse[]> {
    const params: Record<string, string | number> = {
      'dst-address': dstAddress,
      gateway,
    };
    if (distance !== undefined) params.distance = distance;
    return this.execute('/ip/route/add', params);
  }

  // ---- Firewall Filter ----
  async getFirewallRules(chain?: string): Promise<RouterOSResponse[]> {
    return this.execute('/ip/firewall/filter/print', chain ? { chain } : undefined);
  }

  async addFirewallRule(params: {
    chain: string;
    action: string;
    protocol?: string;
    srcAddress?: string;
    dstAddress?: string;
    srcPort?: string;
    dstPort?: string;
    inInterface?: string;
    outInterface?: string;
    comment?: string;
  }): Promise<RouterOSResponse[]> {
    const apiParams: Record<string, string> = {
      chain: params.chain,
      action: params.action,
    };
    if (params.protocol) apiParams.protocol = params.protocol;
    if (params.srcAddress) apiParams['src-address'] = params.srcAddress;
    if (params.dstAddress) apiParams['dst-address'] = params.dstAddress;
    if (params.srcPort) apiParams['src-port'] = params.srcPort;
    if (params.dstPort) apiParams['dst-port'] = params.dstPort;
    if (params.inInterface) apiParams['in-interface'] = params.inInterface;
    if (params.outInterface) apiParams['out-interface'] = params.outInterface;
    if (params.comment) apiParams.comment = params.comment;
    return this.execute('/ip/firewall/filter/add', apiParams);
  }

  async removeFirewallRule(id: string): Promise<RouterOSResponse[]> {
    return this.execute('/ip/firewall/filter/remove', { '.id': id });
  }

  async getFirewallNat(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/firewall/nat/print');
  }

  async addFirewallNat(params: {
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
  }): Promise<RouterOSResponse[]> {
    const apiParams: Record<string, string> = {
      chain: params.chain,
      action: params.action,
    };
    if (params.srcAddress) apiParams['src-address'] = params.srcAddress;
    if (params.dstAddress) apiParams['dst-address'] = params.dstAddress;
    if (params.toAddresses) apiParams['to-addresses'] = params.toAddresses;
    if (params.toPorts) apiParams['to-ports'] = params.toPorts;
    if (params.protocol) apiParams.protocol = params.protocol;
    if (params.dstPort) apiParams['dst-port'] = params.dstPort;
    if (params.outInterface) apiParams['out-interface'] = params.outInterface;
    if (params.comment) apiParams.comment = params.comment;
    return this.execute('/ip/firewall/nat/add', apiParams);
  }

  // ---- DHCP ----
  async getDhcpServers(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/dhcp-server/print');
  }

  async getDhcpLeases(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/dhcp-server/lease/print');
  }

  async addDhcpLease(params: {
    address: string;
    macAddress: string;
    server?: string;
    comment?: string;
  }): Promise<RouterOSResponse[]> {
    const apiParams: Record<string, string> = {
      address: params.address,
      'mac-address': params.macAddress,
    };
    if (params.server) apiParams.server = params.server;
    if (params.comment) apiParams.comment = params.comment;
    return this.execute('/ip/dhcp-server/lease/add', apiParams);
  }

  // ---- DNS ----
  async getDnsSettings(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/dns/print');
  }

  async setDnsServers(servers: string[]): Promise<RouterOSResponse[]> {
    return this.execute('/ip/dns/set', { servers: servers.join(',') });
  }

  async getDnsCache(): Promise<RouterOSResponse[]> {
    return this.execute('/ip/dns/cache/print');
  }

  // ---- Wireless ----
  async getWirelessInterfaces(): Promise<RouterOSResponse[]> {
    return this.execute('/interface/wireless/print');
  }

  async getWirelessRegistrationTable(): Promise<RouterOSResponse[]> {
    return this.execute('/interface/wireless/registration-table/print');
  }

  // ---- Users ----
  async getUsers(): Promise<RouterOSResponse[]> {
    return this.execute('/user/print');
  }

  async addUser(name: string, password: string, group: string = 'full'): Promise<RouterOSResponse[]> {
    return this.execute('/user/add', { name, password, group });
  }

  // ---- Scripts ----
  async getScripts(): Promise<RouterOSResponse[]> {
    return this.execute('/system/script/print');
  }

  async runScript(scriptName: string): Promise<RouterOSResponse[]> {
    const id = await this.resolveScriptId(scriptName);
    return this.execute('/system/script/run', { '.id': id });
  }

  // ---- Backup / Export ----
  async createBackup(name?: string): Promise<RouterOSResponse[]> {
    return this.execute('/system/backup/save', name ? { name } : undefined);
  }

  async exportConfig(): Promise<RouterOSResponse[]> {
    return this.execute('/export');
  }

  // ---- Generic ----
  async executeCommand(
    command: string,
    params?: Record<string, string | number>,
    allowDestructive: boolean = false,
  ): Promise<RouterOSResponse[]> {
    if (!command.startsWith('/')) {
      throw new Error('RouterOS command must start with "/"');
    }
    if (!allowDestructive) {
      const lowered = command.toLowerCase();
      for (const blocked of DESTRUCTIVE_COMMANDS) {
        if (lowered === blocked || lowered.startsWith(blocked + '/')) {
          throw new Error(
            `Command "${command}" is blocked. Set MIKROTIK_ALLOW_DESTRUCTIVE=true to enable.`,
          );
        }
      }
    }
    return this.execute(command, params);
  }
}
