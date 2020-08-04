import { Service, PlatformAccessory } from 'homebridge';

import { KumoDevice } from './kumo-api';

import { KumoHomebridgePlatform } from './platform';

import { KUMO_LAG } from './settings';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class KumoPlatformAccessory {
  //private service: Service;
  private HeaterCooler: Service;
  private Fan: Service;
  private PowerSwitch: Service;

  private lastupdate;

  constructor(
    private readonly platform: KumoHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Mitsubishi')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.zoneTable.unitType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial);

    this.HeaterCooler = this.accessory.getService(
      this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler);
    this.Fan = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.PowerSwitch = this.accessory.getService(
      this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // set sevice names.
    this.HeaterCooler.setCharacteristic(this.platform.Characteristic.Name, 'Heater/Cooler');
    this.Fan.setCharacteristic(this.platform.Characteristic.Name, 'Fan');
    this.PowerSwitch.setCharacteristic(this.platform.Characteristic.Name, 'Power');

    // create handlers for characteristics
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleActiveGet.bind(this))
      .on('set', this.handleActiveSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .on('get', this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .on('get', this.handleTargetHeaterCoolerStateGet.bind(this))
      .on('set', this.handleTargetHeaterCoolerStateSet.bind(this));
    
    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .on('get', this.handleTargetHeaterCoolingThresholdTemperatureGet.bind(this))
      .on('set', this.handleTargetHeaterCoolingThresholdTemperatureSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .on('get', this.handleTargetHeaterHeatingThresholdTemperatureGet.bind(this))
      .on('set', this.handleTargetHeaterHeatingThresholdTemperatureSet.bind(this));

    this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));   
  
    this.Fan.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleFanActiveGet.bind(this))
      .on('set', this.handleFanActiveSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on('get', this.handleFanRotationSpeedGet.bind(this))
      .on('set', this.handleFanRotationSpeedSet.bind(this));

    this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode)
      .on('get', this.handleFanSwingModeGet.bind(this))
      .on('set', this.handleFanSwingModeSet.bind(this));

    this.PowerSwitch.getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handlePowerSwitchOnGet.bind(this))
      .on('set', this.handlePowerSwitchOnSet.bind(this));
  }
  
  // As Device updates take some time to update need to check before updating HAP with stale data.
  async updateDevice() {
    // queryDevice and update context.device depending on last contact/update.

    // queryDevice
    const device: KumoDevice = await this.platform.kumo.queryDevice(this.platform.log, this.accessory.context.serial);   
    //this.platform.log.debug("seconds_since_contact",device.seconds_since_contact);

    // set last contact with device time and  add LAG to ensure command went through
    const lastcontact = Date.now() - ((device.seconds_since_contact + KUMO_LAG) * 1000);
    //this.platform.log.debug("lastcontact from device:", lastcontact);

    //this.platform.log.debug("last sent command to device:", this.lastupdate);

    if(lastcontact < this.lastupdate) {
      // last contact occured before last set operation
      this.platform.log.debug('No recent update from Kumo cloud');
      return false;
    }  

    // update device contect
    this.accessory.context.device = device;          
    return true;
  } 

  // handlers
  async handleActiveGet(callback) {
    // find currentValue
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active).value;

    if(await this.updateDevice()) { 
      //update
      const operation_mode: number = this.accessory.context.device.operation_mode;
      this.platform.log.debug('operation_mode: %s', operation_mode);    
      if (operation_mode === 16) {
        // Unit inactive
        currentValue = 0;
      } else if (operation_mode === 7 || operation_mode === 2) {
        // Fan or Dehumidifier - set Active OFF
        currentValue = 0;
      } else if (operation_mode === 8) {
        // Auto Mode
        currentValue = 1;
      } else if (operation_mode === 1 || operation_mode === 33) {
        // Heating
        currentValue = 1;
      } else if (operation_mode === 3 || operation_mode === 35) {
        // Cooling
        currentValue = 1;
      }

      this.platform.log.debug('Triggered GET Heater/Cooler Active:', currentValue);
    }

    callback(null, currentValue);
  }

  // Handle requests to set the "Active" characteristic
  handleActiveSet(value, callback) {
    const value_old: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.Active).value;

    let command: Record<string, unknown> | undefined;
    if(value === 0 && value_old === 1) {
      // turn ON fan mode
      command = {'operationMode':7};
    } else if(value === 1 && value_old === 0) {
      // turn ON auto mode
      command = {'power':1, 'operationMode':8};
    }

    if(command !== undefined) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
      this.lastupdate = Date.now();
      this.platform.log.debug('Triggered SET Heater/Cooler Active:', value);  
    }
    callback(null);
  }

  // Handle requests to get the current value of the "Current Heater Cooler State" characteristic
  async handleCurrentHeaterCoolerStateGet(callback) {
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value;

    if(await this.updateDevice()) {
      // update
      const operation_mode: number = this.accessory.context.device.operation_mode;
      this.platform.log.debug('operation_mode: %s', operation_mode);
      
      if (operation_mode === 16) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
      } else if (operation_mode === 7 || operation_mode === 2) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      } else if (operation_mode === 1 || operation_mode === 33) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      } else if (operation_mode === 3 || operation_mode === 35) {
        currentValue = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      }

      this.platform.log.debug('Triggered GET CurrentHeaterCoolerState:', currentValue);
    }
        
    callback(null, currentValue);
  }

  // Handle requests to get the current value of the "Target Heater Cooler State" characteristic
  async handleTargetHeaterCoolerStateGet(callback) {
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value;

    if(await this.updateDevice()) {
      // update
      const operation_mode: number = this.accessory.context.device.operation_mode;
      this.platform.log.debug('operation_mode: %s', operation_mode);

      if (operation_mode === 8 || operation_mode === 35 || operation_mode === 33) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      } else if (operation_mode === 1) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      } else if (operation_mode === 3) {
        currentValue = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      }

      this.platform.log.debug('Triggered GET TargetHeaterCoolerState:', currentValue);
    }

    callback(null, currentValue);
  }

  // Handle requests to set the "Target Heater Cooler State" characteristic
  handleTargetHeaterCoolerStateSet(value, callback) {
    const value_old: number = <number>this.HeaterCooler.getCharacteristic(
      this.platform.Characteristic.TargetHeaterCoolerState).value;

    let command: Record<string, unknown> | undefined;
    if(value !== value_old){
      if(value === this.platform.Characteristic.TargetHeaterCoolerState.AUTO) {
        command = {'power':1, 'operationMode':8};
      } else if(value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
        command = {'power':1, 'operationMode':1};
      } else if(value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
        command = {'power':1, 'operationMode':3};
      }
    }

    if(command !== undefined) {
      this.PowerSwitch.updateCharacteristic(this.platform.Characteristic.Active, 1);
      this.platform.kumo.execute(this.accessory.context.serial, command);
      this.lastupdate = Date.now();
      this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);  
    }
    callback(null);
  }  

  async handleTargetHeaterCoolingThresholdTemperatureGet(callback) {
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(
      this.platform.Characteristic.CoolingThresholdTemperature).value;

    if(await this.updateDevice()) {
      // set this to a valid value for CurrentTemperature
      currentValue = this.accessory.context.device.sp_cool;
      this.platform.log.debug('Triggered GET TargetHeaterCoolingThresholdTemperature:', currentValue);
    }

    callback(null, currentValue);
  }

  async handleTargetHeaterHeatingThresholdTemperatureGet(callback) {
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(
      this.platform.Characteristic.HeatingThresholdTemperature).value;

    if(await this.updateDevice()) {
      // set this to a valid value for CurrentTemperature
      currentValue = this.accessory.context.device.sp_heat;
      this.platform.log.debug('Triggered GET TargetHeaterHeatingThresholdTemperature:', currentValue);
    }

    callback(null, currentValue);
  }

  handleTargetHeaterCoolingThresholdTemperatureSet(value, callback) {
    const minCoolSetpoint: number = this.accessory.context.zoneTable.minCoolSetpoint;
    
    if(value<minCoolSetpoint) {
      value = minCoolSetpoint;
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, minCoolSetpoint);
    }
    
    const command: Record<string, unknown> = {'spCool':Math.floor(value)};
    
    this.platform.kumo.execute(this.accessory.context.serial, command);
    this.lastupdate = Date.now();
    this.platform.log.debug('Triggered SET TargetHeaterCoolingThresholdTemperature:', value);
    callback(null);
  }  

  handleTargetHeaterHeatingThresholdTemperatureSet(value, callback) {
    const maxHeatSetpoint: number = this.accessory.context.zoneTable.maxHeatSetpoint;

    if(value>maxHeatSetpoint) {
      value = maxHeatSetpoint;
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, maxHeatSetpoint);
    }

    const command: Record<string, unknown> = {'spHeat':Math.floor(value)};
    
    this.platform.kumo.execute(this.accessory.context.serial, command);
    this.lastupdate = Date.now();
    this.platform.log.debug('Triggered SET TargetHeaterHeatingThresholdTemperature:', value);
    callback(null);
  }  

  async handleCurrentTemperatureGet(callback) {
    let currentValue: number = <number>this.HeaterCooler.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value;

    if(await this.updateDevice()) {
      // set this to a valid value for CurrentTemperature
      currentValue = this.accessory.context.device.room_temp;
      this.platform.log.debug('Triggered GET CurrentTemperature:', currentValue);
    }

    callback(null, currentValue);
  }

  async handleFanActiveGet(callback) {
    let currentValue: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.Active).value;

    if(await this.updateDevice()) {
      // retrieve fan_speed
      const fan_speed: number = this.accessory.context.device.fan_speed;

      if(fan_speed > 0 && this.accessory.context.device.power === 1) {
        currentValue = 1;
      } else {
        currentValue = 0;
      }
      this.platform.log.debug('Triggered GET Manual FanActive:', currentValue);
    }

    callback(null, currentValue);
  }

  async handleFanActiveSet(value, callback) {
    // logic to set active on fan 
    let command: Record<string, unknown> | undefined;   
    if(value === 0) {
      // fan to auto
      command = {'fanSpeed':0};
    } else if(value === 1) {    
      // check power status
      if(await this.updateDevice()) {
        if(this.accessory.context.device.power === 1 && this.accessory.context.device.fan_speed === 0) {
          // set fanSpeed
          command = {'fanSpeed':1};  
          this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        } else {
          // set power to on, operationMode to 7 and fanSpeed
          command = {'power':1, 'operationMode':7, 'fanSpeed':1};
          this.PowerSwitch.updateCharacteristic(this.platform.Characteristic.On, 1);
          this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
        }
      }
    }

    // only issue a command if not null
    if(command !== undefined) {
      this.platform.kumo.execute(this.accessory.context.serial, command);    
      this.lastupdate = Date.now();
      this.platform.log.debug('Triggered SET Manual FanActive:', value);
    }
    callback(null);
  }

  async handleFanRotationSpeedGet(callback) {
    let currentValue: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).value;

    if(await this.updateDevice()) {
      // retrieve fan_speed
      const fan_speed = this.accessory.context.device.fan_speed;
      this.platform.log.debug('fan_speed:', fan_speed);

      currentValue = (fan_speed - 1) * 20;
      this.platform.log.debug('Triggered GET handleFanRotationSpeed:', currentValue);
    }

    callback(null, currentValue);
  }

  handleFanRotationSpeedSet(value, callback) {
    const value_old: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).value;

    const speed_old: number = Math.floor(value_old / 20) + 1;
    const speed: number = Math.floor(value / 20) + 1;

    // only send command if fan_speed has changed
    if(speed !== speed_old) {
      // send comand to update fanSpeed    
      const command: Record<string, unknown> = {'fanSpeed':speed};
      this.platform.kumo.execute(this.accessory.context.serial, command);    
      this.platform.log.debug('Triggered SET handleFanRotationSpeed:', speed);
    }
    this.lastupdate = Date.now();
    callback(null);
  }

  async handleFanSwingModeGet(callback) {
    let currentValue: number = <number>this.Fan.getCharacteristic(this.platform.Characteristic.SwingMode).value;

    if(await this.updateDevice()) {
      // retrieve air_direction
      const air_direction: number = this.accessory.context.device.air_direction;
      this.platform.log.debug('air_direction:', air_direction);

      if(air_direction === 7) {
        currentValue = this.platform.Characteristic.SwingMode.SWING_ENABLED;
      } else {
        currentValue = this.platform.Characteristic.SwingMode.SWING_DISABLED;
      }

      this.platform.log.debug('Triggered GET handleFanSwingMode:', currentValue);
    }

    callback(null, currentValue);
  }
  
  handleFanSwingModeSet (value, callback) {

    let command: Record<string, unknown> | undefined;
    if(value === this.platform.Characteristic.SwingMode.SWING_ENABLED){
      command = {'airDirection':7};
    } else {
      command = {'airDirection':0};
    }

    this.platform.kumo.execute(this.accessory.context.serial, command); 
    this.lastupdate = Date.now();
    callback(null);
  }

  async handlePowerSwitchOnGet(callback) {
    let currentValue: number = <number>this.PowerSwitch.getCharacteristic(this.platform.Characteristic.On).value;

    if(await this.updateDevice()) {
      currentValue = this.accessory.context.device.power;
      this.platform.log.debug('Triggered GET PowerSwitch Active:', currentValue);
    }
    
    callback(null, currentValue);
  }

  handlePowerSwitchOnSet(value, callback) {
    let command: Record<string, unknown> | undefined;
    if(!value) {
      command = {'power':0, 'operationMode':16};
      // turn off other services to refect power off
      this.HeaterCooler.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.Active, 0);
      this.Fan.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
    } else {
      // turn on Fan with auto fanSpeed and airDirection
      command = {'power':1, 'operationMode':7, 'fanSpeed':0, 'airDirection':0};
    }

    if(command !== undefined) {
      this.platform.kumo.execute(this.accessory.context.serial, command);
      this.lastupdate = Date.now();
      this.platform.log.debug('Triggered SET PowerSwitch Active:', value);  
    }
    callback(null);
  }

}


