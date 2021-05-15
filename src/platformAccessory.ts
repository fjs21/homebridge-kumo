import { Service, PlatformAccessory } from 'homebridge';

import fakegato from 'fakegato-history';

import { KumoDevice, KumoDeviceDirect } from './kumo-api';

import { KumoHomebridgePlatform } from './platform';

import { KUMO_LAG, KUMO_DEVICE_WAIT } from './settings';

/*
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KumoPlatformAccessory {
  //private service: Service;
  private Thermostat: Service;
  private Fan: Service;
  private PowerSwitch: Service;

  private lastupdate;
  private lastquery;

  private directAccess;

  private historyService: fakegato.FakeGatoHistoryService;

  constructor(
    private readonly platform: KumoHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.directAccess = this.platform.config.directAccess;
    // this accessory does not support direct access currently (2020-10-12)
    this.directAccess = false; 

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.zoneTable.unitType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial);

    this.Thermostat = this.accessory.getService(
      this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);
    this.Fan = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.PowerSwitch = this.accessory.getService(
      this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // set sevice names.
    this.Thermostat.setCharacteristic(this.platform.Characteristic.Name, 'Thermostat');
    this.Fan.setCharacteristic(this.platform.Characteristic.Name, 'Fan');
    this.PowerSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Power');

    // create handlers for characteristics
    this.Thermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .on('get', this.handleGet.bind(this));

    this.Thermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleTargetHeatingCoolingStateSet.bind(this));
    
    this.Thermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleTargetTemperatureSet.bind(this));

    this.Thermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.handleGet.bind(this));   
  
    this.Fan.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleFanActiveSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleFanRotationSpeedSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleFanSwingModeSet.bind(this));

    this.PowerSwitch.getCharacteristic(this.platform.Characteristic.On)
      .on('set', this.handlePowerSwitchOnSet.bind(this));
  
    this.updateDevice();

    // setup interval for updating device for historyService
    const historyInterval = 10; // history interval in minutes

    const FakeGatoHistoryService = fakegato(this.platform.api);
    this.historyService = new FakeGatoHistoryService('weather', this.accessory, {
      storage: 'fs',
      minutes: historyInterval,
    });
    this.historyService.name = this.Thermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    //this.historyService.log = this.platform.log; // switched off to prevent flooding the log

    setInterval(() => {
      this.platform.log.debug('Running interval');
      this.updateAccessoryCharacteristics();
    }, 1000 * 60 * historyInterval);
  }

  // handlers GET
  async handleGet(callback) {
    await this.updateAccessoryCharacteristics();
    callback(null);
  }

  async updateAccessoryCharacteristics() {
    // updateAccessoryCharacteristics

    // update context.device information from Kumo or Directly
    if(!await this.updateDevice()) { 
      return false;
    }
    
    // update characteristics from context.device
    this.updateCurrentHeatingCoolingState();
    this.updateTargetHeatingCoolingState();
    this.updateTargetTemperature();
    this.updateCurrentTemperature();
    this.updateFanActive();
    this.updateFanRotationSpeed();
    this.updateFanSwingMode();
    this.updatePowerSwitchOn();

    //this.platform.log.debug('updateAccessoryCharacteristic completed (%s)', this.accessory.context.serial)
    return true;
  }
  
  // As Device updates take some time to update need to check before updating HAP with stale data.
  async updateDevice() {
    // queryDevice and update context.device depending on last contact/update.
    let device: KumoDevice | KumoDeviceDirect;
    if (!this.directAccess){
      // queryDevice via Kumo Cloud
      device = await this.platform.kumo.queryDevice(this.accessory.context.serial);   
      if(!device) {
        this.platform.log.warn('queryDevice failed.');
        return false;
      }
      // set last contact with device time and  add LAG to ensure command went through
      const lastcontact = Date.now() - ((device.seconds_since_contact + KUMO_LAG) * 1000);
     
      if(lastcontact < this.lastupdate) {
        // last contact occured before last set operation
        this.platform.log.debug('queryDevice: No recent update from Kumo cloud');
        return false;
      }
      this.platform.log.debug('queryDevice success.');  

    } else {
      // queryDevice via Direct IP connection
      // only update if data is more than one second old - prevents spamming the device
      if ((Date.now() - KUMO_DEVICE_WAIT) < this.lastquery) {
        //this.platform.log.debug('Recent update from device already performed.');
        if(!this.accessory.context.device) {
          this.platform.log.warn('queryDevice_Direct: accessory context not set - bad IP? reverting to cloud control');
          this.directAccess = false;
          return false;
        }
        return true; //ok to use current data in context to update Characteristic values
      }
      this.lastquery = Date.now(); // update time of last query     
     
      device = await this.platform.kumo.queryDevice_Direct(this.accessory.context.serial);
      if(!device) {
        this.platform.log.warn('queryDevice_Direct failed.');
        return false;
      }
      this.platform.log.debug('queryDevice_Direct success.');
    }

    // update device contect
    this.accessory.context.device = device;          
    return true;
  } 

  private updateCurrentHeatingCoolingState() {
    // CurrentHeatingCoolingState
    const operation_mode: number = this.accessory.context.device.operation_mode;
    const mode: string = this.accessory.context.device.mode;

    let currentValue: number = <number>this.Thermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).value;
    if (operation_mode === 16 || mode === 'off') {
      currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else if (operation_mode === 7 || operation_mode === 10
        || mode === 'vent' || mode === 'dry') {
      currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else if (operation_mode === 9 
        || mode === 'heat' || mode === 'autoHeat') {
      currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    } else if (operation_mode === 11 
        || mode === 'cool' || mode === 'autoCool') {
      currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    }
    this.Thermostat.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, currentValue);  
  }

  private updateTargetHeatingCoolingState() {
    // TargetHeatingCoolingState
    const operation_mode: number = this.accessory.context.device.operation_mode;
    const mode: string = this.accessory.context.device.mode;

    let currentValue: number = <number>this.Thermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).value;
    if (operation_mode === 8 || mode === 'auto' || mode === 'autoHeat' || mode === 'autoCool') {
      currentValue = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    } else if (operation_mode === 9 || mode === 'heat') {
      currentValue = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    } else if (operation_mode === 11 || mode === 'cool') {
      currentValue = this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    } else {
      // could be bad idea to capture OFF target with else
      currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF; 
    }
    this.Thermostat.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, currentValue);
  }

  private updateTargetTemperature() {
    // TargetHeaterCoolingThresholdTemperature
    let currentValue: number = <number>this.Thermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature).value;
    if(this.accessory.context.device.setTemp === undefined) {
      currentValue = this.accessory.context.device.setTemp;
    } else {
      currentValue = this.accessory.context.device.set_temp_a;
    }
    this.Thermostat.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, currentValue);
  }
  
  private updateCurrentTemperature() {
    // CurrentTemperature
    let currentValue: number = <number>this.Thermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value;
    if(this.accessory.context.device.room_temp === undefined) {
      currentValue = this.accessory.context.device.roomTemp;
    } else {
      currentValue = this.accessory.context.device.room_temp_a;
    }
    this.Thermostat.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, currentValue);

    // add history service entry
    this.historyService.addEntry({
      time: Date.now(),
      temp: currentValue,
    });
  }
  
  private updateFanActive() {
    // FanActive
    const power: number = this.accessory.context.device.power;
    const fan_speed: number = this.accessory.context.device.fan_speed;  
    const mode: string = this.accessory.context.device.mode;
    const fanAuto: boolean = this.accessory.context.device.fanSpeed === 'auto';

    let currentValue: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.Active).value;
    if(
      (fan_speed > 0 && power === 1 && !this.directAccess) ||
      (!fanAuto && mode !== 'off' && this.directAccess)
    ) {
      currentValue = 1;
    } else {
      currentValue = 0;
    }
    this.Fan.updateCharacteristic(this.platform.Characteristic.Active, currentValue);
  }
  
  private updateFanRotationSpeed() {
    // FanRotationSpeed
    const fan_speed: number = this.accessory.context.device.fan_speed; 
    const fanSpeed: string = this.accessory.context.device.fanSpeed;

    let currentValue: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).value;
    // fanSpeed decoder ring.
    const fanStateMap: {[index: string]: number} = {
      auto: 0,
      superQuiet: 1,
      quiet: 2,
      low: 3,
      powerful: 5,
      superPowerful: 6,
    };
    if (!this.directAccess) {
      currentValue = (fan_speed - 1) * 20;
    } else {
      currentValue = (fanStateMap[fanSpeed] - 1) * 20;  
    }
    this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, currentValue);
  }
  
  private updateFanSwingMode() {  
    // FanSwingMode
    const air_direction: number = this.accessory.context.device.air_direction;
    const vaneDir: string = this.accessory.context.device.vaneDir;  

    let currentValue: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode).value;
    // retrieve air_direction
    if(air_direction === 7 || vaneDir === 'swing') {
      currentValue = this.platform.Characteristic.SwingMode.SWING_ENABLED;
    } else {
      currentValue = this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }
    this.Fan.updateCharacteristic(this.platform.Characteristic.SwingMode, currentValue);
  }
  
  private updatePowerSwitchOn() {
    // PowerSwitchOn
    const power: number = this.accessory.context.device.power;
    const mode: string = this.accessory.context.device.mode;

    let currentValue: boolean = <boolean>this.PowerSwitch.getCharacteristic(this.platform.Characteristic.On).value;
    if (power === 0 || mode === 'off') {
      currentValue = false;
    } else {
      currentValue = true;
    }
    this.PowerSwitch.updateCharacteristic(this.platform.Characteristic.On, currentValue);
  }
  
  // handlers SET

  // Handle requests to set the "Active" characteristic
  handleActiveSet(value, callback) {
    const value_old: number = <number>this.Thermostat.getCharacteristic(this.platform.Characteristic.Active).value;

    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(value === 0 && value_old === 1) {
      // turn ON fan mode
      command = {'operationMode':7};
      commandDirect = {'mode':'vent'};
    } else if(value === 1 && value_old === 0) {
      // use existing TargetHeaterCoolerState
      const value: number = <number>this.Thermostat.getCharacteristic(
        this.platform.Characteristic.TargetHeatingCoolingState).value;
      if(value === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
        command = {'power':1, 'operationMode':8};
        commandDirect = {'mode': 'auto'};
      } else if(value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        command = {'power':1, 'operationMode':1};
        commandDirect = {'mode': 'heat'};
      } else if(value === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        command = {'power':1, 'operationMode':3};
        commandDirect = {'mode': 'cool'};
      } else {
        // turn ON auto mode if not already set.
        command = {'power':1, 'operationMode':8};
        commandDirect = {'mode': 'auto'};
      }
    }

    if(command !== undefined || commandDirect !== undefined) {
      if(command !== undefined && !this.directAccess) {
        this.platform.kumo.execute(this.accessory.context.serial, command);
      } else if (commandDirect !== undefined && this.directAccess) {
        this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.lastupdate = Date.now();
      this.platform.log.info('Heater/Cooler: set Active from %s to %s', value_old, value);  
    }
    callback(null);
  }

  // Handle requests to set the "Target Heater Cooler State" characteristic
  handleTargetHeatingCoolingStateSet(value, callback) {
    const value_old: number = <number>this.Thermostat.getCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState).value;

    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(value !== value_old){
      if(value === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
        command = {'power':1, 'operationMode':8};
        commandDirect = {'mode':'auto'};
      } else if(value === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        command = {'power':1, 'operationMode':1};
        commandDirect = {'mode':'heat'};
      } else if(value === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        command = {'power':1, 'operationMode':3};
        commandDirect = {'mode':'cool'};
      }
    }

    if(command !== undefined || commandDirect !== undefined) {
      this.PowerSwitch.updateCharacteristic(this.platform.Characteristic.Active, 1);
      if(command !== undefined && !this.directAccess) {
        this.platform.kumo.execute(this.accessory.context.serial, command);
      } else if (commandDirect !== undefined && this.directAccess) {
        this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.lastupdate = Date.now();
      this.platform.log.info('Thermostat: set TargetState from %s to %s.', value_old, value);  
    }
    callback(null);
  }  

  handleTargetTemperatureSet(value, callback) {
    //const minCoolSetpoint: number = this.accessory.context.zoneTable.minCoolSetpoint;
   
    value = this.roundHalf(value);
    this.Thermostat.updateCharacteristic(this.platform.Characteristic.TargetTemperature, value);

    const command: Record<string, unknown> = {'set_temp_a':value};
    const commandDirect: Record<string, unknown> = {'setTemp':value};
    
    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('Thermostat: set TargetTemperature to %s', value);
    callback(null);
  }  

  async handleFanActiveSet(value, callback) {
    // logic to set active on fan 
    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;   
    if(value === 0) {
      // fan to auto
      command = {'fanSpeed':0};
      commandDirect = {'fanSpeed':'auto'};
    } else if(value === 1) {    
      // check power status
      if(await this.updateDevice()) {
        if(
          (this.accessory.context.device.power === 1 && this.accessory.context.device.fan_speed === 0) ||
          (this.accessory.context.device.mode !== 'off' && this.accessory.context.device.fanSpeed === 'auto')
        ) {
          // if power ON and fan speed = AUTO,set fan speed from auto to superQuiet:1
          command = {'fanSpeed':1}; 
          commandDirect = {'fanSpeed':'superQuiet'}; 
          this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        } else if (this.accessory.context.device.power === 0 || this.accessory.context.device.mode === 'off' ) {
          // if power OFF, set power to on, operationMode to 7 (vent) and fanSpeed to superQuiet:1
          command = {'power':1, 'operationMode':7, 'fanSpeed':1};
          commandDirect = {'mode':'vent', 'fanSpeed':'superQuiet'};
          this.PowerSwitch.updateCharacteristic(this.platform.Characteristic.On, 1);
          this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        }
      }
    }

    // only issue a command if not null
    if(command !== undefined || commandDirect !== undefined) {
      if(command !== undefined && !this.directAccess) {
        this.platform.kumo.execute(this.accessory.context.serial, command);
      } else if (commandDirect !== undefined && this.directAccess) {
        this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.lastupdate = Date.now();
      this.platform.log.info('Fan: set Active to %s.', value);
    }
    callback(null);
  }

  handleFanRotationSpeedSet(value, callback) {
    const value_old: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).value;

    const speed_old: number = Math.floor(value_old / 20) + 1;
    const speed: number = Math.floor(value / 20) + 1;

    // only send command if fan_speed has changed
    if(speed !== speed_old) {
      // send comand to update fanSpeed    
      const command: Record<string, number> = {'fanSpeed':speed};

      // fanSpeed decoder ring.
      const fanStateMap: {[index: number]: string} = {
        0: 'auto',
        1: 'superQuiet',
        2: 'quiet',
        3: 'low',
        5: 'powerful',
        6: 'superPowerful',
      };

      const commandDirect: Record<string, string> = {'fanSpeed':fanStateMap[speed]};
      this.platform.log.info('commandDirect: %s.', commandDirect);

      if(!this.directAccess) {
        this.platform.kumo.execute(this.accessory.context.serial, command);
      } else {
        this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
      }
      this.platform.log.info('Fan: set RotationSpeed from %s to %s.', speed_old, speed);
    }
    this.lastupdate = Date.now();
    callback(null);
  }


  handleFanSwingModeSet (value, callback) {
    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(value === this.platform.Characteristic.SwingMode.SWING_ENABLED){
      command = {'airDirection':7};
      commandDirect = {'vaneDir':'swing'};
    } else {
      command = {'airDirection':0};
      commandDirect = {'vaneDir':'auto'};
    }

    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('Fan: set Swing to %s.', value);  
    callback(null);
  }

  handlePowerSwitchOnSet(value, callback) {
    let command: Record<string, unknown> | undefined;
    let commandDirect: Record<string, unknown> | undefined;
    if(!value) {
      command = {'power':0, 'operationMode':16};
      commandDirect = {'mode':'off'};
      // turn off other services to refect power off
      this.Thermostat.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
    } else {
      // turn on Fan with auto fanSpeed and airDirection
      command = {'power':1, 'operationMode':7, 'fanSpeed':0, 'airDirection':0};
      commandDirect = {'mode':'vent', 'fanSpeed':'superQuiet', 'vaneDir':'auto'}; 
      this.Thermostat.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, 1);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.SwingMode, 
        this.platform.Characteristic.SwingMode.SWING_DISABLED);
    }
  
    if(!this.directAccess) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
    } else {
      this.platform.kumo.execute_Direct(this.accessory.context.serial, commandDirect);
    }
    this.lastupdate = Date.now();
    this.platform.log.info('PowerSwitch: set Active to %s.', value);  
    callback(null);
  }

  private roundHalf(num: number) {
    return Math.round(num*2)/2;
  }
}


