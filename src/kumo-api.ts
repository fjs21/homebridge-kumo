import { Logger } from 'homebridge';
import fetch from 'node-fetch';
import util from 'util';

import { 
  KUMO_LOGIN_URL, 
  KUMO_DEVICE_UPDATES_URL,
  KUMO_DEVICE_INFREQUENT_UPDATES_URL,
  KUMO_DEVICE_EXECUTE_URL, 
  KUMO_API_TOKEN_REFRESH_INTERVAL, 
} from './settings';

interface KumoDeviceInterface {
  active_thermistor: string,
  actual_fan_speed: number,
  air_direction: number,
  device_serial: string,
  fan_speed: number,
  id: string,
  it_status: string,
  operation_mode: number,
  out_of_use: string,
  power: number,
  prohibit_local_remote_control: string,
  raw_frames: string,
  record_time: string,
  room_temp: number,
  room_temp_a: number,
  room_temp_beyond: number,
  rssi: number,
  run_test: number,
  seconds_since_contact: number,
  set_temp: number,
  set_temp_a: number,
  sp_auto: number,
  sp_cool: number,
  sp_heat: number,
  status_display: number,
  temp_source: number,
  two_figures_code: string,
  unusual_figures: number,
}

export type KumoDevice = Readonly<KumoDeviceInterface>;

// Renew Kumo security credentials every so often, in hours.
const KumoTokenExpirationWindow = KUMO_API_TOKEN_REFRESH_INTERVAL * 60 * 60 * 1000;

export class KumoApi {
  Devices!: Array<KumoDevice>;
  devices;

  private username: string;
  private password: string;
  private securityToken!: string;
  private securityTokenTimestamp!: number;
  private lastAuthenticateCall!: number;
  private lastRefreshDevicesCall!: number;

  private log: Logger;

  private headers = {
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Accept': 'application/json, text/plain, */*', 
    'DNT': '1',
    'User-Agent': '',
    'Content-Type': 'application/json;charset=UTF-8',
    'Origin': 'https://app.kumocloud.com',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Referer': 'https://app.kumocloud.com',
    'Accept-Language': 'en-US,en;q=0.9',
  }

  // Initialize this instance with our login information.
  constructor(log: Logger, username: string, password: string) {
    this.log = log;
    this.username = username;
    this.password = password;
    this.devices = [];
  }

  async acquireSecurityToken() {
    const now = Date.now();

    // Reset the API call time.
    this.lastAuthenticateCall = now;

    // Login to the myQ API and get a security token for our session.
    const response = await fetch(KUMO_LOGIN_URL, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({'username':this.username, 'password':this.password, 'appVersion':'2.2.0'}),
    });

    if(!response) {
      this.log.warn('Kumo API: Unable to authenticate. Will try later.');
      return false;
    }

    // get security token
    const data = await response.json();
    this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 5 }));

    // What we should get back upon successfully calling /Login is a security token for
    // use in future API calls this session.
    if(!data || !data[0].token) {
      this.log.info('Kumo API: Unable to acquire a security token.');
      return false;
    }

    // On initial plugin startup, let the user know we've successfully connected.
    if(!this.securityToken) {
      this.log.info('Kumo API: Successfully connected to the Kumo API.');
      // Find devices and serial numbers
      const zoneTable = data[2].children[0].zoneTable;
      this.devices = [];
      for (const serial in zoneTable) {
        this.log.debug(`Serial: ${serial}`);
        this.log.debug(`Label: ${zoneTable[serial].label}`);
        const device = {
          serial: serial,
          label: zoneTable[serial].label,
          zoneTable: zoneTable[serial],
        };
        this.devices.push(device);
      }  
      this.log.info('Number of devices found:', this.devices.length);
    }

    this.securityToken = data[0].token;
    this.securityTokenTimestamp = now;

    this.log.debug('Token: %s', this.securityToken);

    // Add the token to our headers that we will use for subsequent API calls.
    //this.headers.SecurityToken = this.securityToken;

    return true;
  }

  // Refresh the security token.
  private async checkSecurityToken(): Promise<boolean> {
    const now = Date.now();

    // If we don't have a security token yet, acquire one before proceeding.
    if(!this.securityToken && !(await this.acquireSecurityToken())) {
      return false;
    }

    // Is it time to refresh? If not, we're good for now.
    if((now - this.securityTokenTimestamp) < KumoTokenExpirationWindow) {
      return true;
    }

    // We want to throttle how often we call this API to no more than once every 5 minutes.
    if((now - this.lastAuthenticateCall) < (1 * 60 * 1000)) {
      this.log.info('Kumo API: throttling acquireSecurityToken API call.');

      return true;
    }

    this.log.info('Kumo API: acquiring a new security token.');

    // Now generate a new security token.
    if(!(await this.acquireSecurityToken())) {
      return false;
    }

    return true;
  }

  async queryDevice(log: Logger, serial: string) {
    // Validate and potentially refresh our security token.
    if(!(await this.checkSecurityToken())) {
      return null as unknown as KumoDevice;
    }

    // Get Device Information
    const response = await fetch(KUMO_DEVICE_UPDATES_URL, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify([this.securityToken, [serial]]),
    });

    const data = await response.json();

    if(!data || !data[2]) {
      log.info('Kumo API: error querying device: %s.', serial);
      return null as unknown as KumoDevice;
    }

    //this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));

    const device: KumoDevice = data[2][0][0];

    return device;
  }

  // Execute an action on a Kumo device.
  async execute(serial: string, command: Record<string, unknown>): Promise<boolean> {
    // Validate and potentially refresh our security token.
    if(!(await this.checkSecurityToken())) {
      return false;
    }

    const dict = {};
    dict[serial]=command;
    this.log.debug(JSON.stringify([this.securityToken, dict]));

    const response = await fetch(KUMO_DEVICE_EXECUTE_URL, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify([this.securityToken, dict]),
    });

    const data = await response.json();

    if(!data) {
      this.log.warn('Kumo API: Unable to send the command to Kumo servers. Acquiring a new security token.');
      this.securityTokenTimestamp = 0;
      return false;
    }

    this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));
    if(data[2][0][0] != serial){
      this.log.warn('Kumo API: Bad response.');
    }

    return true;
  }

  async infrequentQuery(log: Logger, serial: string) {
    // Validate and potentially refresh our security token.
    if(!(await this.checkSecurityToken())) {
      return false;
    }

    // Get Device Information
    const response = await fetch(KUMO_DEVICE_INFREQUENT_UPDATES_URL, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify([this.securityToken, [serial]]),
    });

    const data = await response.json();

    if(!data) {
      log.warn('Kumo API: error querying device: %s.', serial);
      return false;
    }

    //this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));

    return true;
  }
}
