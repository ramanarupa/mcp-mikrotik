import { RouterOSAPI } from 'node-routeros';

export class MikroTikClient {
  private api: RouterOSAPI;
  private host: string;
  private user: string;
  private password: string;
  private port: number;

  constructor(host: string, user: string, password: string, port: number = 8728) {
    this.host = host;
    this.user = user;
    this.password = password;
    this.port = port;
    this.api = new RouterOSAPI({
      host: this.host,
      user: this.user,
      password: this.password,
      port: this.port,
    });
  }

  private async connect(): Promise<void> {
    if (!this.api.connected) {
      await this.api.connect();
    }
  }

  private async disconnect(): Promise<void> {
    if (this.api.connected) {
      await this.api.close();
    }
  }

  private paramsToArray(params?: Record<string, any>): string[] {
    if (!params) return [];
    return Object.entries(params).map(([key, value]) => {
      return `=${key}=${value}`;
    });
  }

  private async execute(command: string, params?: Record<string, any>): Promise<any[]> {
    await this.connect();
    try {
      const paramArray = this.paramsToArray(params);
      const result = await this.api.write(command, paramArray);
      return result;
    } finally {
      await this.disconnect();
    }
  }

  // System information
  async getSystemInfo(): Promise<any[]> {
    return await this.execute('/system/resource/print');
  }

  async getSystemIdentity(): Promise<any[]> {
    return await this.execute('/system/identity/print');
  }

  async setSystemIdentity(name: string): Promise<any[]> {
    return await this.execute('/system/identity/set', { name });
  }

  // Interface management
  async getInterfaces(): Promise<any[]> {
    return await this.execute('/interface/print');
  }

  async getInterfaceStats(interfaceName?: string): Promise<any[]> {
    const params = interfaceName ? { interface: interfaceName } : undefined;
    return await this.execute('/interface/monitor-traffic', params);
  }

  async enableInterface(interfaceName: string): Promise<any[]> {
    return await this.execute('/interface/enable', { '.id': interfaceName });
  }

  async disableInterface(interfaceName: string): Promise<any[]> {
    return await this.execute('/interface/disable', { '.id': interfaceName });
  }

  // IP Address management
  async getIpAddresses(): Promise<any[]> {
    return await this.execute('/ip/address/print');
  }

  async addIpAddress(address: string, iface: string, network?: string): Promise<string> {
    const params: Record<string, any> = {
      address,
      interface: iface,
    };
    if (network) {
      params.network = network;
    }
    await this.execute('/ip/address/add', params);
    return 'success';
  }

  async removeIpAddress(id: string): Promise<string> {
    await this.execute('/ip/address/remove', { '.id': id });
    return 'success';
  }

  // IP Route management
  async getRoutes(): Promise<any[]> {
    return await this.execute('/ip/route/print');
  }

  async addRoute(dstAddress: string, gateway: string, distance?: number): Promise<string> {
    const params: Record<string, any> = {
      'dst-address': dstAddress,
      gateway,
    };
    if (distance !== undefined) {
      params.distance = distance;
    }
    await this.execute('/ip/route/add', params);
    return 'success';
  }

  // Firewall management
  async getFirewallRules(chain?: string): Promise<any[]> {
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
  }): Promise<string> {
    const apiParams: Record<string, any> = {
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

    await this.execute('/ip/firewall/filter/add', apiParams);
    return 'success';
  }

  async removeFirewallRule(id: string): Promise<string> {
    await this.execute('/ip/firewall/filter/remove', { '.id': id });
    return 'success';
  }

  async getFirewallNat(): Promise<any[]> {
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
  }): Promise<string> {
    const apiParams: Record<string, any> = {
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

    await this.execute('/ip/firewall/nat/add', apiParams);
    return 'success';
  }

  // DHCP Server
  async getDhcpServers(): Promise<any[]> {
    return await this.execute('/ip/dhcp-server/print');
  }

  async getDhcpLeases(): Promise<any[]> {
    return await this.execute('/ip/dhcp-server/lease/print');
  }

  async addDhcpLease(params: {
    address: string;
    macAddress: string;
    server?: string;
    comment?: string;
  }): Promise<string> {
    const apiParams: Record<string, any> = {
      address: params.address,
      'mac-address': params.macAddress,
    };

    if (params.server) apiParams.server = params.server;
    if (params.comment) apiParams.comment = params.comment;

    await this.execute('/ip/dhcp-server/lease/add', apiParams);
    return 'success';
  }

  // DNS
  async getDnsSettings(): Promise<any[]> {
    return await this.execute('/ip/dns/print');
  }

  async setDnsServers(servers: string[]): Promise<string> {
    await this.execute('/ip/dns/set', { servers: servers.join(',') });
    return 'success';
  }

  async getDnsCache(): Promise<any[]> {
    return await this.execute('/ip/dns/cache/print');
  }

  // Wireless (if available)
  async getWirelessInterfaces(): Promise<any[]> {
    return await this.execute('/interface/wireless/print');
  }

  async getWirelessRegistrationTable(): Promise<any[]> {
    return await this.execute('/interface/wireless/registration-table/print');
  }

  // Users
  async getUsers(): Promise<any[]> {
    return await this.execute('/user/print');
  }

  async addUser(name: string, password: string, group: string = 'full'): Promise<string> {
    await this.execute('/user/add', { name, password, group });
    return 'success';
  }

  // Scripts
  async getScripts(): Promise<any[]> {
    return await this.execute('/system/script/print');
  }

  async runScript(scriptName: string): Promise<any[]> {
    return await this.execute('/system/script/run', { '.id': scriptName });
  }

  // Generic command execution
  async executeCommand(command: string, params?: Record<string, any>): Promise<any[]> {
    return await this.execute(command, params);
  }

  // Backup and export
  async createBackup(name?: string): Promise<string> {
    const params = name ? { name } : undefined;
    await this.execute('/system/backup/save', params);
    return 'Backup created successfully';
  }

  async exportConfig(): Promise<any[]> {
    return await this.execute('/export');
  }
}
