import { Logger } from 'homebridge';
import fetch from 'node-fetch';
import util from 'util';

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

interface KumoDeviceDirectInterface {
  active_thermistor: string,
  defrost: boolean,
  fanSpeed: string,
  filterDirty: boolean,
  hotAdjust: boolean,
  mode: string,
  roomTemp: number,
  runTest: number,
  spCool: number,
  spHeat: number,
  standby: boolean,
  tempSource: string,
  vaneDir: string,
}

export type KumoDeviceDirect = Readonly<KumoDeviceDirectInterface>;

// Renew Kumo security credentials every so often, in hours.
const KumoTokenExpirationWindow = KUMO_API_TOKEN_REFRESH_INTERVAL * 60 * 60 * 1000;

export class KumoApi {
  //Devices!: Array<KumoDevice>;
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

  async queryDevice(serial: string) {
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
      this.log.warn('Kumo API: error querying device: %s.', serial);
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
    if(data[2][0][0] !== serial){
      this.log.warn('Kumo API: Bad response.');
    }

    return true;
  }

  async infrequentQuery(serial: string) {
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
      this.log.warn('Kumo API: error querying device: %s.', serial);
      return false;
    }

    //this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));

    return true;
  }

  // ImplementDirectAccess
  async queryDevice_Direct(serial: string) {  
    
    const data = await this.directRequest('{"c":{"indoorUnit":{"status":{}}}}', serial);
    let device: KumoDeviceDirect;
    if(!data){
      return null as unknown as KumoDeviceDirect;
    }

    try {
      device = <KumoDeviceDirect>data.r.indoorUnit.status;  
    } catch {
      this.log.warn('Kump API: bad response from queryDevice_Direct - %s', data);
      return null as unknown as KumoDeviceDirect;
    }

    queryDeviceSensors_Direct();

    return device;    
  }

  // Execute an action DIRECTLY on a Kumo device.
  async execute_Direct(serial: string, command: Record<string, unknown>): Promise<boolean> {
    const post_data = '{"c":{"indoorUnit":{"status":' + JSON.stringify(command) + '}}}';
    this.log.debug('post_data: %s.', post_data);
    const data = await this.directRequest(post_data, serial);

    if(!data) {
      this.log.warn('Kumo API: Failed to send command directly to device (Serial: %s).', serial);
      return false;
    }

    this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));
    return true;
  }

  // querying sensors
  async queryDeviceSensors_Direct(serial: string) {
    const data = await this.directRequest('{"c":{"sensors":{}}}', serial);
    this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));
    
    /*
    let device: KumoDeviceDirect;
    if(!data){
      return null as unknown as KumoDeviceDirect;
    }

    try {
      device = <KumoDeviceDirect>data.r.indoorUnit.status;  
    } catch {
      this.log.warn('Kump API: bad response from queryDevice_Direct - %s', data);
      return null as unknown as KumoDeviceDirect;
    }
    */
    return true;    
  }

  // querying sensors
  async queryDeviceSensors_Direct(serial: string)
    const data = await this.directRequest('{"c":{"sensors":{}}}', serial);
    this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));
    //let device: KumoDeviceDirect;
    if(!data){
      //return null as unknown as KumoDeviceDirect;
    }

    try {
      //device = <KumoDeviceDirect>data.r.indoorUnit.status;  
    } catch {
      this.log.warn('Kump API: bad response from queryDevice_Direct - %s', data);
      return null as unknown as KumoDeviceDirect;
    }
    //return device;    
  }

  // sends request
  private async directRequest(post_data: string, serial: string) {
    let zoneTable; 
    for (const device of this.devices) {
      if (device.serial === serial){
        zoneTable = device.zoneTable;
      }
    }
    const address: string = zoneTable.address;
    const cryptoSerial: string = zoneTable.cryptoSerial; 
    const password: string = zoneTable.password; 
    
    const url = 'http://' + address + '/api?m=' +
      this.encodeToken(post_data, password, cryptoSerial);
    //log.debug('url_encodeToken:', url);

    let data;

    // Get Device Information

    // catch any errors that fetch throws - i.e. timeout
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json'},
        body: post_data,
        retry: 3,
        callback: retry => {
          this.log.debug('Retrying %s.', retry); 
        },
      });
      // check response from server
      if (response.status >= 200 && response.status <= 299) {
        data = await response.json();
      } else {
        this.log.warn('Kumo API: response error from device: %s', serial);
        return null; 
      } 
    } catch(error) {
      // if fetch throws error 
      this.log.warn('queryDevice_Direct error: %s.', error);
      return null;  
    }
    
    if (!data || data == '{ _api_error: \'device_authentication_error\' }') {
      this.log.warn('Kumo API: error direct querying device: %s.', serial);
      return null;
    }

    //this.log.debug(util.inspect(data, { colors: true, sorted: true, depth: 3 }));
    return data;
  }

  private encodeToken(post_data, password, cryptoSerial) {
    // calcuate a token - based on pykumo and homebridge-kumo-local
    const W = this.h2l(KUMO_KEY);
    const p = base64.decode(password);
    
    const data_hash = sjcl.codec.hex.fromBits(
      sjcl.hash.sha256.hash(
        sjcl.codec.hex.toBits(
          this.l2h(
            Array.prototype.map.call(p + post_data, (m2) => {
              return m2.charCodeAt(0);
            }),
          ),
        ),
      ),
    );
    // convert data_hash to byteArray
    const data_hash_byteArray = this.h2l(data_hash);
 
    const intermediate = new Uint8Array(88);
    for (let i = 0; i < 32; i++) {
      intermediate[i] = W[i];
      intermediate[i + 32] = data_hash_byteArray[i];
    }
    intermediate[64] = 8;
    intermediate[65] = 64;
    intermediate[66] = 0; //S_PARAM
    
    // convert cryptoSerial to byte array
    const cryptoserial = this.h2l(cryptoSerial);

    intermediate[79] = cryptoserial[8];
    for (let i = 0; i < 4; i++) {
      intermediate[i + 80] = cryptoserial[i + 4];
      intermediate[i + 84] = cryptoserial[i];
    }
    const hash = sjcl.codec.hex.fromBits(
      sjcl.hash.sha256.hash(sjcl.codec.hex.toBits(this.l2h(intermediate))),
    );
    return hash;
  }

  // convert hexstring to byteArray
  private h2l (dt) {
    const r: any = [];
    for (let i = 0; i < dt.length; i += 2) {
      r.push(parseInt(dt.substr(i, 2), 16));
    }
    return r;
  }

  // convert from byteArray to hexstring 
  private l2h (l) {
    let r = '';
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