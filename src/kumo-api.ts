import { Logger } from 'homebridge';
import fetch from 'node-fetch';
import util from 'util';
import CryptoJS from 'crypto-js';

import sjcl from 'sjcl';
import base64 from 'base-64';

import { 
  KUMO_LOGIN_URL, 
  KUMO_DEVICE_UPDATES_URL,
  KUMO_DEVICE_INFREQUENT_UPDATES_URL,
  KUMO_DEVICE_EXECUTE_URL, 
  KUMO_API_TOKEN_REFRESH_INTERVAL, 
  KUMO_KEY,
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

// constants for direct device connection.
const W_PARAM = new util.TextEncoder().encode(KUMO_KEY);
const S_PARAM = 0;

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
      this.log.warn('Kumo API: Unable to acquire a security token.');
      return false;
    }

    // On initial plugin startup, let the user know we've successfully connected.
    if(!this.securityToken) {
      this.log.info('Kumo API: Successfully connected to the Kumo API.');
      // Find devices and serial numbers
      this.devices = [];
      for (const child of data[2].children) {
        const zoneTable = child.zoneTable;
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
      this.log.warn('Kumo API: throttling acquireSecurityToken API call.');

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
      log.warn('Kumo API: error querying device: %s.', serial);
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

  // ImplementDirectAccess
  async queryDevice_Direct(log: Logger, serial: string) {  
    let zoneTable; 
    for (const device of this.devices) {
      if (device.serial === serial){
        zoneTable = device.zoneTable;
      }
    }
    const address: string = zoneTable.address;
    const cryptoSerial: string = zoneTable.cryptoSerial; // KCS
    const password: string = zoneTable.password; // Kcryptopassword
    
    const url = 'http://' + address + '/api?m=' +
      this.encodeToken('{"c":{"indoorUnit":{"status":{}}}}', password, cryptoSerial);
    //log.info('url_encodeToken:', url);
    const url1 = 'http://' + address + '/api?m=' +
      this.encodeToken1('{"c":{"indoorUnit":{"status":{}}}}', password, cryptoSerial);
    //log.info('url_encodeToken1:', url1)
    /*
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
      log.warn('Kumo API: error querying device: %s.', serial);
      return null as unknown as KumoDevice;
    }

    //this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));

    const device: KumoDevice = data[2][0][0];

    return device;
    */
  }

  private encodeToken(post_data, password, cryptoSerial) {
    //const data_hash = hashlib.sha256(password + post_data).digest();
    const data_hash = CryptoJS.SHA256(password + post_data);
    //console.log(data_hash);
    /*
    //let intermediate = bytearray(88);
    let intermediate = new Uint8Array(88);
    //intermediate[0:32] = W_PARAM[0:32]
    //intermediate[32:64] = data_hash[0:32]
    for (let i = 0; i <= 32; i++) {
      intermediate[i] = W_PARAM[i];
      intermediate[i + 32] = data_hash[i];
    }
    //intermediate[64:66] = bytearray.fromhex("0840")
    for (let i = 64; i <= 66; i++) {
      intermediate[i] = 0x0840;
    }
    intermediate[66] = S_PARAM;
    const cryptoserial = new TextEncoder.encode(cryptoSerial)
    intermediate[79] = cryptoserial[8];
    //intermediate[80:84] = cryptoSerial[4:8]
    //intermediate[84:88] = cryptoSerial[0:4]
    for (let i = 0; i <= 4; i++) {
      intermediate[i + 80] = cryptoserial[i];
      intermediate[i + 84] = cryptoserial[i + 4];
    }
    console.log(intermediate);
    //const token = hashlib.sha256(intermediate).hexdigest();
    const token = CryptoJS.SHA256(intermediate).toString();

    return token;
    */
  }

  private encodeToken1(post_data, password, cryptoSerial) {
    const W = this.h2l(KUMO_KEY);
    const p = base64.decode(password);
    const dta = post_data;
    const dt1 = sjcl.codec.hex.fromBits(
      sjcl.hash.sha256.hash(
        sjcl.codec.hex.toBits(
          this.l2h(
            Array.prototype.map.call(p + dta, (m2) => {
              return m2.charCodeAt(0);
            }),
          ),
        ),
      ),
    );
    //console.log(dt1);
    /*
    let dt1_l: any = this.h2l(dt1);
    let dt2 = '';
    for (let i = 0; i < 88; i++) {
        dt2 += '00'
    }
    let dt3: any = this.h2l(dt2);
    dt3[64] = 8;
    dt3[65] = 64;
    Array.prototype.splice.apply(dt3, [32, 32].concat(dt1_l));
    dt3[66] = 0;
    let cryptoserial = this.h2l(cryptoSerial);
    dt3[79] = cryptoserial[8];
    dt3[80] = cryptoserial[4];
    dt3[81] = cryptoserial[5];
    dt3[82] = cryptoserial[6];
    dt3[83] = cryptoserial[7];
    dt3[84] = cryptoserial[0];
    dt3[85] = cryptoserial[1];
    dt3[86] = cryptoserial[2];
    dt3[87] = cryptoserial[3];
    Array.prototype.splice.apply(dt3, [0, 32].concat(W));
    let hash = sjcl.codec.hex.fromBits(
        sjcl.hash.sha256.hash(sjcl.codec.hex.toBits(this.l2h(dt3)))
    )
    //this.log('hash: %s', hash);
    //this.log('kumo command: %s', dt);
    return hash;
    */
  }

  private h2l (dt) {
    const r: any = [];
    for (let i = 0; i < dt.length; i += 2) {
      r.push(parseInt(dt.substr(i, 2), 16));
    }
    return r;
  }

  private l2h (l) {
    let r: any = '';
    for (let i = 0; i < l.length; ++i) {
      const c = l[i];
      if (c < 16) {
        r += '0';
      }
      r += Number(c).toString(16);
    }
    return r;
  }
}