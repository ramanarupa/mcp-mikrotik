import { RouterOSAPI } from 'node-routeros';

export type RouterOSResponse = Record<string, string>;

export class MikroTikClient {
  private host: string;
  private user: string;
  private password: string;
  private port: number;

  constructor(host: string, user: string, password: string, port: number = 8728) {
    this.host = host;
    this.user = user;
    this.password = password;
    this.port = port;
  }

  private paramsToArray(params?: Record<string, string | number>): string[] {
    if (!params) return [];
    return Object.entries(params).map(([key, value]) => `=${key}=${value}`);
  }

  private async execute(command: string, params?: Record<string, string | number>): Promise<RouterOSResponse[]> {
    const api = new RouterOSAPI({
      host: this.host,
      user: this.user,
      password: this.password,
      port: this.port,
    });
    await api.connect();
    try {
      const paramArray = this.paramsToArray(params);
      return await api.write(command, paramArray) as RouterOSResponse[];
    } finally {
      await api.close();
    }
  }

  // System information
  async getSystemInfo(): Promise<RouterOSResponse[]> {
    return await this.execute('/system/resource/print');
  }

  async getSystemIdentity(): Promise<RouterOSResponse[]> {
    return await this.execute('/system/identity/print');
  }

  async setSystemIdentity(name: string): Promise<RouterOSResponse[]> {
    return await this.execute('/system/identity/set', { name });
  }

  // Interface management
  async getInterfaces(): Promise<RouterOSResponse[]> {
    return await this.execute('/interface/print');
  }

  async enableInterface(interfaceName: string): Promise<RouterOSResponse[]> {
    return await this.execute('/interface/enable', { '.id': interfaceName });
  }

  async disableInterface(interfaceName: string): Promise<RouterOSResponse[]> {
    return await this.execute('/interface/disable', { '.id': interfaceName });
  }

  // IP Address management
  async getIpAddresses(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/address/print');
  }

  async addIpAddress(address: string, iface: string, network?: string): Promise<RouterOSResponse[]> {
    const params: Record<string, string> = {
      address,
      interface: iface,
    };
    if (network) {
      params.network = network;
    }
    return await this.execute('/ip/address/add', params);
  }

  async removeIpAddress(id: string): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/address/remove', { '.id': id });
  }

  // IP Route management
  async getRoutes(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/route/print');
  }

  async addRoute(dstAddress: string, gateway: string, distance?: number): Promise<RouterOSResponse[]> {
    const params: Record<string, string | number> = {
      'dst-address': dstAddress,
      gateway,
    };
    if (distance !== undefined) {
      params.distance = distance;
    }
    return await this.execute('/ip/route/add', params);
  }

  // Firewall management
  async getFirewallRules(chain?: string): Promise<RouterOSResponse[]> {
    const params = chain ? { chain } : undefined;
    return await this.execute('/ip/firewall/filter/print', params);
  }

  async addFirewallRule(params: {
    chain: string;
    action: string;
    protocol?: string;
    srcAddress?: string;
    dstAddress?: string;
    dstPort?: string;
    srcPort?: string;
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
    if (params.dstPort) apiParams['dst-port'] = params.dstPort;
    if (params.srcPort) apiParams['src-port'] = params.srcPort;
    if (params.inInterface) apiParams['in-interface'] = params.inInterface;
    if (params.outInterface) apiParams['out-interface'] = params.outInterface;
    if (params.comment) apiParams.comment = params.comment;

    return await this.execute('/ip/firewall/filter/add', apiParams);
  }

  async removeFirewallRule(id: string): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/firewall/filter/remove', { '.id': id });
  }

  async getFirewallNat(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/firewall/nat/print');
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

    return await this.execute('/ip/firewall/nat/add', apiParams);
  }

  // DHCP Server
  async getDhcpServers(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/dhcp-server/print');
  }

  async getDhcpLeases(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/dhcp-server/lease/print');
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

    return await this.execute('/ip/dhcp-server/lease/add', apiParams);
  }

  // DNS
  async getDnsSettings(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/dns/print');
  }

  async setDnsServers(servers: string[]): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/dns/set', { servers: servers.join(',') });
  }

  async getDnsCache(): Promise<RouterOSResponse[]> {
    return await this.execute('/ip/dns/cache/print');
  }

  // Wireless (if available)
  async getWirelessInterfaces(): Promise<RouterOSResponse[]> {
    return await this.execute('/interface/wireless/print');
  }

  async getWirelessRegistrationTable(): Promise<RouterOSResponse[]> {
    return await this.execute('/interface/wireless/registration-table/print');
  }

  // Users
  async getUsers(): Promise<RouterOSResponse[]> {
    return await this.execute('/user/print');
  }

  async addUser(name: string, password: string, group: string = 'full'): Promise<RouterOSResponse[]> {
    return await this.execute('/user/add', { name, password, group });
  }

  // Scripts
  async getScripts(): Promise<RouterOSResponse[]> {
    return await this.execute('/system/script/print');
  }

  async runScript(scriptName: string): Promise<RouterOSResponse[]> {
    return await this.execute('/system/script/run', { '.id': scriptName });
  }

  // Generic command execution
  async executeCommand(command: string, params?: Record<string, string | number>): Promise<RouterOSResponse[]> {
    return await this.execute(command, params);
  }

  // Backup and export
  async createBackup(name?: string): Promise<RouterOSResponse[]> {
    const params = name ? { name } : undefined;
    return await this.execute('/system/backup/save', params);
  }

  async exportConfig(): Promise<RouterOSResponse[]> {
    return await this.execute('/export');
  }
}
