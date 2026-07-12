import { RouterOSAPI } from 'node-routeros';
import { createRequire } from 'node:module';

// ---- Runtime patch for node-routeros v1.6.9 crash bugs ----
// The library throws SYNCHRONOUSLY from inside the socket 'data' callback in
// two spots. Those throws are outside any promise, so they surface as an
// uncaughtException and kill the whole process — the MCP client then reports
// "Connection closed" (reproducible on /routing/rule/print, environment/print,
// and other large/streamed replies while a keepalive '#' channel is in flight).
//   - Receiver.sendTagData(): throws 'UNREGISTEREDTAG' when a late/duplicate
//     sentence arrives for a tag whose channel already closed. The real channel
//     already resolved, so the stray data is safe to DROP.
//   - Channel.onUnknown(): throws 'UNKNOWNREPLY' on an unrecognized reply word.
//     Non-fatal — LOG and move on.
// This patch must run before any RouterOSAPI/Channel is constructed (it does:
// module load time), so Channel's constructor binds the patched onUnknown.
(() => {
  try {
    const req = createRequire(import.meta.url);
    const { Receiver } = req('node-routeros/dist/connector/Receiver.js');
    const { Channel } = req('node-routeros/dist/Channel.js');
    Receiver.prototype.sendTagData = function (this: any, currentTag: string): void {
      const tag = this.tags.get(currentTag);
      if (tag) {
        tag.callback(this.currentPacket);
      } else {
        console.error('[MCP-MARKER] node-routeros: dropped data on unregistered tag', currentTag);
      }
      this.cleanUp();
    };
    Channel.prototype.onUnknown = function (this: any, reply: string): void {
      // RouterOS returns the reply word '!empty' for some empty print results
      // (e.g. /routing/rule/print with 0 rows). node-routeros only knows
      // !re/!done/!trap and lands here. The stock method throws 'UNKNOWNREPLY';
      // even with the throw suppressed the channel would close WITHOUT ever
      // emitting 'done', so the write promise hangs until the timeout. Resolve
      // it with whatever data accumulated (for '!empty' that is []), which is
      // the correct result and lets the command return normally.
      console.error('[MCP-MARKER] node-routeros: resolving write on unknown reply', reply);
      this.emit('done', this.data);
    };
    console.error('[MCP-MARKER] node-routeros crash patch applied');
  } catch (e) {
    console.error(
      '[MCP-MARKER] node-routeros crash patch FAILED (server may still crash):',
      e instanceof Error ? e.message : String(e),
    );
  }
})();

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
      timeout: opts.timeout ?? 30,
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
    // Marker to stderr — correlate with an uncaughtException/unhandledRejection
    // marker to see which command was in flight when node-routeros threw from
    // inside the socket 'data' callback (Channel.onUnknown / Receiver.sendTagData).
    console.error('[MCP-MARKER] execute >>', command, paramArray.length ? JSON.stringify(paramArray) : '');
    let api: RouterOSAPI;
    try {
      api = await this.getConnection();
      const rows = await this.writeWithTimeout(api, command, paramArray);
      console.error('[MCP-MARKER] execute <<', command, `rows=${rows.length}`);
      return rows;
    } catch (err) {
      console.error('[MCP-MARKER] execute !!', command, err instanceof Error ? err.message : String(err));
      // Single retry on stale-connection class of errors.
      if (this.isConnectionError(err)) {
        console.error('[MCP-MARKER] execute retry', command);
        this.api = null;
        api = await this.getConnection();
        return this.writeWithTimeout(api, command, paramArray);
      }
      throw err;
    }
  }

  /**
   * Wrap api.write() with a hard timeout. The library's channel promise can
   * hang forever if a reply is never delivered (e.g. after a suppressed
   * unknown reply, or a dropped stray tag). On timeout we drop the cached
   * connection so the next call reconnects cleanly, and reject so the tool
   * returns an error instead of the request hanging until the MCP client
   * gives up (which the user sees as "Connection closed").
   */
  private writeWithTimeout(
    api: RouterOSAPI,
    command: string,
    paramArray: string[],
  ): Promise<RouterOSResponse[]> {
    const ms = (this.options.timeout + 5) * 1000;
    return new Promise<RouterOSResponse[]>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.error('[MCP-MARKER] execute TIMEOUT', command, `${ms}ms`);
        if (this.api === api) this.api = null; // force reconnect next call
        reject(new Error(`RouterOS write timed out after ${ms}ms (connection reset)`));
      }, ms);
      api.write(command, paramArray).then(
        (rows) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(rows as RouterOSResponse[]);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
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

  // ---- Logs ----
  /**
   * Search the RouterOS system log (`/log/print`). Fetches the log buffer and
   * filters client-side (RouterOS API can't do `where`/substring queries):
   *  - `topics`: comma-separated; an entry matches if its topics contain ANY
   *    of the given values (case-insensitive substring).
   *  - `message`: case-insensitive substring, or a regex when `regex` is true.
   * Returns matched entries newest-first, capped at `limit` (default 100),
   * each as `{ time, topics, message }`.
   */
  async searchLogs(opts: {
    message?: string;
    topics?: string;
    regex?: boolean;
    limit?: number;
  }): Promise<RouterOSResponse[]> {
    let out = (await this.execute('/log/print')) as Array<Record<string, unknown>>;

    if (opts.topics) {
      const wanted = opts.topics
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
      if (wanted.length > 0) {
        out = out.filter((r) => {
          const topics = String(r.topics ?? '').toLowerCase();
          return wanted.some((w) => topics.includes(w));
        });
      }
    }

    if (opts.message && opts.message.length > 0) {
      if (opts.regex) {
        let re: RegExp;
        try {
          re = new RegExp(opts.message, 'i');
        } catch (err) {
          throw new Error(
            `Invalid regex in "message": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        out = out.filter((r) => re.test(String(r.message ?? '')));
      } else {
        const needle = opts.message.toLowerCase();
        out = out.filter((r) => String(r.message ?? '').toLowerCase().includes(needle));
      }
    }

    // `/log/print` returns oldest-first; present newest-first.
    out = out.slice().reverse();

    const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : 100;
    return out.slice(0, limit).map((r) => ({
      time: r.time,
      topics: r.topics,
      message: r.message,
    }));
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
